# AI 结构化输出

在使用 AI 生成内容时，经常需要严格的可解析的输出用于下游处理，而非自由格式的文本。

我开发的 AI 工作流中包括 “AI 生成 Pull Request”，PR 需要包含标题和描述两个字段，我需要结构化的 JSON 供后续流程使用。

期望输出：

```json
{
  "title": "feat: 新增登录流程",
  "body": "新增登录流程，支持用户通过邮箱和密码进行身份验证，校验数据库中的凭据，并在认证成功后返回会话令牌。"
}
```

## 方案一：纯提示词手动解析

最开始的方式是在提示词中要求模型返回 JSON，然后手动解析输出。

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
  console.log(pr.title);
  console.log(pr.body);
} catch {
  console.log("error")
};

```

没有结构化输出，Claude 可能会生成格式错误的 JSON 响应或无效的工具输入，这会破坏您的应用程序。即使进行了仔细的提示，您也可能遇到：

来自无效 JSON 语法的解析错误
缺少必需字段
数据类型不一致
需要错误处理和重试的模式违规
结构化输出通过受限解码保证模式兼容的响应：

始终有效：不再有 JSON.parse() 错误
类型安全：保证字段类型和必需字段
可靠：不需要为模式违规重试

## 方案二：拆分请求手动组装

方案一的问题根源在于 “一次性让模型输出完整 JSON”。模型擅长生成文本，但不擅长同时控制多个字段的格式。我的改进思路是：将任务拆分为多个独立请求，每个请求只负责生成一个字段，最后手动组装。

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
console.log(pr);
```

这个方案解决了方案一的部分问题：

| 维度 | 方案一 | 方案二 |
| --- | --- | --- |
| 输出稳定性 | JSON 解析偶发失败 | 每个字段独立生成，无需解析 JSON |
| 字段隔离 | 一个字段格式错误影响整体 | 各字段互不影响 |
| 并行能力 | 不支持 | `Promise.all` 并行请求 |

但仍有不足：

* **Token 消耗翻倍**：diff 被发送了两次，上下文重复计算。
* **字段间缺乏关联**：标题和描述独立生成，可能出现标题说 "feat"，描述却写成 "fix" 的不一致情况。
* **组装逻辑需手动维护**：字段数量变化时，需要修改代码中的请求和组装逻辑。

## 方案三：原生结构化输出

方案二的核心思路是"拆分任务以规避格式问题"，但真正的问题是：模型本身缺乏输出结构化数据的原生能力。主流 AI SDK 已经提供了原生的结构化输出支持，让模型在生成时就遵循预定义的 JSON Schema，从根本上解决格式和类型问题。

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
  console.log(pr.title);
  console.log(pr.body);
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
console.log(pr.title);
console.log(pr.body);
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

结构化输出的演进路线，本质上是将"格式保证"的职责从提示词转移到 SDK/模型层面：

* **方案一**：完全依赖提示词约束，格式保证靠"祈祷"。
* **方案二**：通过拆分任务规避格式问题，但付出额外 token 和一致性代价。
* **方案三**：利用 SDK 原生能力，由底层保证输出格式，提示词只需关注内容质量。

工程实践中的建议：

* **优先使用原生结构化输出**：如果使用的 SDK 支持（OpenAI `response_format`、Anthropic Tool Use），直接使用，无需在提示词中费力描述 JSON 格式。
* **Tool Use 不仅用于调用工具**：Anthropic 的 Tool Use 是实现结构化输出的事实标准，即使场景与"工具调用"无关，也可以用来约束输出结构。
* **Schema 设计要精确**：善用 `required`、`enum`、`description` 等字段，Schema 越精确，模型输出越可靠。
