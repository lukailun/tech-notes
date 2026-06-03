# AI 结构化输出

在使用 AI 生成内容时，经常需要严格的、可解析的输出用于下游处理，而非自由格式的文本。

以我开发的 “AI 生成 Pull Request” 工作流为例，PR 需要包含标题和描述两个字段，我需要结构化的 JSON 供后续流程使用：

```json
{
  "title": "feat: 新增登录流程",
  "body": "新增登录流程，支持用户通过邮箱和密码进行身份验证，校验数据库中的凭据，并在认证成功后返回会话令牌。"
}
```

下面我以这个场景为例，介绍我尝试过的三种方案。

## 方案一：纯提示词手动解析

最直觉的方式是在提示词中要求模型返回 JSON，然后手动解析输出。

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: `根据以下代码 diff 生成 PR 的标题和描述，以 JSON 格式返回，格式如下：
{
  "title": "PR 标题",
  "body": "PR 描述"
}

只返回 JSON，不要包含其他文字。

代码 diff:
……`,
    },
  ],
});

const text = response.content[0].type === "text" ? response.content[0].text : "";
try {
  const pr = JSON.parse(text)
  console.log("PR 标题:", pr.title);
  console.log("PR 描述:", pr.body);
} catch (error) {
  console.error("JSON 解析失败:", error);
}
```

这种方式的问题在于，即使提示词中明确要求返回 JSON，模型仍然可能输出格式错误的内容：

* 解析错误：模型生成了无效的 JSON 语法，`JSON.parse()` 直接抛异常。
* 字段缺失：模型缺失输出某个必需字段。
* 类型不一致：期望 `string` 类型但模型输出 `number` 类型。
* 额外文本：模型在 JSON 前后附带额外内容。

即使加上错误处理和重试逻辑，这种方案也并不完全可靠，因为我没有采用。

## 方案二：拆分请求手动组装

我后续的改进思路是：将任务拆分为多个独立请求，每个请求只负责生成一个字段，最后手动组装。

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const diff = `……`;

const [titleResponse, bodyResponse] = await Promise.all([
  client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `根据以下代码 diff，生成一个简洁的 PR 标题。只返回标题文本，不要包含其他内容。

代码 diff:
${diff}`,
      },
    ],
  }),
  client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `根据以下代码 diff，生成一段 PR 描述。只返回描述文本，不要包含其他内容。

代码 diff:
${diff}`,
      },
    ],
  }),
]);

const title = titleResponse.content[0].type === "text" ? titleResponse.content[0].text.trim() : "";
const body = bodyResponse.content[0].type === "text" ? bodyResponse.content[0].text.trim() : "";

const pr = { title, body };
console.log("PR 标题:", pr.title);
console.log("PR 描述:", pr.body);
```

这个方案成功解决方案一输出稳定性的问题：每个字段独立生成，无需解析 JSON。但并不是一个完美的解决方案，因为它存在以下问题：

* 消耗增倍：请求被发送多次，上下文重复计算。
* 字段间缺乏关联：标题和描述独立生成，可能出现标题写成 feat，描述写成 fix 的不一致情况。
* 组装逻辑需手动维护：字段数量变化时，需要修改代码中的请求和组装逻辑。

前期我采用这种方案，成功满足我的需求。后期通过查询 Claude 的结构化输出文档，我优化为方案三。

## 方案三：原生结构化输出

方案二通过拆分任务规避 JSON 解析问题，但代价是消耗增倍。真正的问题在于：大模型前期能力有限，以文本优先，所以只能使用文本生成的方式解决结构化数据。

但随着大模型能力的提高，大模型自身已经提供原生的结构化输出支持，让模型在生成时就遵循预定义的 JSON 格式，从根本上解决结构化输出问题。

### Anthropic：Tool Use 实现结构化输出

Anthropic 的 API 没有独立的 "structured output" 端点，但可以通过 Tool Use 机制实现等价效果。核心思路是：定义一个"工具"，其参数 schema 就是我们期望的输出结构，让模型"调用"这个工具来传递结构化数据。

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const diff = `……`;

const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  tools: [
    {
      name: "create_pr",
      description: "创建 Pull Request",
      input_schema: {
        type: "object" as const,
        properties: {
          title: {
            type: "string",
            description: "PR 标题，使用 conventional commits 格式",
          },
          body: {
            type: "string",
            description: "PR 描述",
          },
        },
        required: ["title", "body"],
      },
    },
  ],
  tool_choice: { type: "tool", name: "create_pr" },
  messages: [
    {
      role: "user",
      content: `根据以下代码 diff，生成 PR 的标题和描述。

代码 diff:
${diff}`,
    },
  ],
});

const toolBlock = response.content.find((block) => block.type === "tool_use");
if (toolBlock && toolBlock.type === "tool_use") {
  const pr = toolBlock.input as { title: string; body: string };
  console.log("PR 标题:", pr.title);
  console.log("PR 描述:", pr.body);
}
```

关键点在于 `tool_choice: { type: "tool", name: "create_pr" }`，这会强制模型调用指定工具，而非自由回复文本。模型的输出会严格遵循 `input_schema` 定义的 JSON Schema，无需手动解析。

### OpenAI：Response Format 实现结构化输出

OpenAI 提供了更直接的 `response_format` 参数，支持传入 JSON Schema 约束输出格式。

```ts
import OpenAI from "openai";

const client = new OpenAI();
const diff = `+ function calculateTotal(items: CartItem[]): number {
+   return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
+ }`;

const response = await client.chat.completions.create({
  model: "gpt-4o",
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "pr",
      strict: true,
      schema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "PR 标题，使用 conventional commits 格式",
          },
          body: {
            type: "string",
            description: "PR 描述",
          },
        },
        required: ["title", "body"],
        additionalProperties: false,
      },
    },
  },
  messages: [
    {
      role: "user",
      content: `根据以下代码 diff，生成 PR 的标题和描述。

代码 diff:
${diff}`,
    },
  ],
});

const pr = JSON.parse(response.choices[0].message.content!);
console.log("PR 标题:", pr.title);
console.log("PR 描述:", pr.body);
```

### 对比

| 维度 | 方案一：纯提示词 | 方案二：拆分请求 | 方案三：原生结构化输出 |
| --- | --- | --- | --- |
| 格式可靠性 | 低，依赖模型"遵守指令" | 中，规避了 JSON 解析但文本仍不稳定 | 高，由 SDK 层面保证格式 |
| 类型安全 | 无 | 无 | 有，JSON Schema 约束字段类型和必填项 |
| Token 消耗 | 1x | 2x（diff 重复发送） | 1x |
| 字段关联 | 有关联但格式不可控 | 无关联 | 有关联且格式可控 |
| 代码复杂度 | 低 | 中 | 低 |

## 总结

三种方案的演进，本质上是将"格式保证"的职责从提示词转移到 SDK 层面：

| | 方案一 | 方案二 | 方案三 |
| --- | --- | --- | --- |
| **格式保证方** | 提示词 | 拆分规避 | SDK/模型 |
| **可靠性** | 低 | 中 | 高 |
| **Token 消耗** | 1x | 2x | 1x |
| **字段关联** | 有（但不可控） | 无 | 有（且可控） |

工程实践中的建议：

* **优先使用原生结构化输出**：如果 SDK 支持（OpenAI `response_format`、Anthropic Tool Use），直接使用，无需在提示词中描述 JSON 格式。
* **Tool Use 不仅用于调用工具**：Anthropic 的 Tool Use 是实现结构化输出的事实标准，即使场景与"工具调用"无关，也可以用来约束输出结构。
* **Schema 设计要精确**：善用 `required`、`enum`、`description` 等字段，Schema 越精确，模型输出越可靠。
