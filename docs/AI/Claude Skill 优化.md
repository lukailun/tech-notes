# Claude Skill 优化

最近使用 Claude 为自身工作流开发多个 Skill 时，实践中发现一个问题：Skill 写得越详细，响应质量反而越差。排查后发现，根本原因是自己一直用编写文档的思路编写 Skill。

实际上，编写 Skill 和编写文档是两种截然不同的思维模式：

* 文档：面向人类阅读，追求详尽全面。
* Skill：面向 AI Agent 执行，追求精简明确。

关键区别在于：人类可以自主选择性阅读文档，信息冗余有益无害；但 AI Agent 的上下文窗口是共享资源，每一个字符都有成本，加载冗余内容反而降低核心指令的权重。

## Skill 简介

### Skill 格式

每个 Skill 均以独立目录形式存在，包含以下文件：

```
/skill-name/
├── SKILL.md # 核心指令
├── scripts/ # 可执行脚本
├── references/ # 参考文档
└── assets/ # 模板文件、图片等
```

### 渐进式披露 (Progressive Disclosure)

Claude 针对 Skill 的加载采用分层加载、按需调用的渐进式披露机制，核心目标是节省上下文 token、提升响应效率。

- metadata 常驻上下文：对话启动时，Claude 会将所有 Skill 的 metadata 加载并常驻在上下文中，用于快速识别 Skill。
- SKILL.md 按需加载：当用户的请求内容命中某个 Skill 时，Claude 会将该 Skill 对应的 SKILL.md 正文加载到上下文，以加载当前任务所需的核心指令。
- references/ 文件按需读取：references/ 文件夹下的参考文档不会自动加载到上下文，仅当 Agent 在执行的过程中需要补充参考信息时，才会读取对应文件。

## 优化前的 Skill

以下为优化前的 `create-merge-request` Skill，通过 [OpenAI Tokenizer](https://platform.openai.com/tokenizer)（GPT-5.x 标准）统计，包含 702 字符、311 token，存在信息冗余、重点不突出的问题。

``````
---
name: create-merge-request
description: 创建 GitLab 合并请求。在创建 GitLab 合并请求(MR) 时使用。
---

## 创建合并请求

自动创建 GitLab 合并请求,包含智能目标分支选择和 AI 生成的描述。

## 要求

1. 需要安装并配置 glab CLI 工具
2. 需要配置 ANTHROPIC_BASE_URL 和 ANTHROPIC_AUTH_TOKEN 环境变量

## 执行步骤

1. 运行 create-merge-request 脚本创建合并请求

   **使用方法:**
   ```bash
   bun run .claude/skills/create-merge-request/scripts/create-merge-request.ts
   ```

   **功能:**
   - 自动确定目标分支（最新的 release/x.x.x 分支）
   - 比较当前分支与目标分支的代码改动
   - 使用 AI 生成合并请求的标题和描述
   - 使用 glab CLI 创建合并请求

   **环境变量要求:**
   - `ANTHROPIC_BASE_URL`: Anthropic API 的 base URL
   - `ANTHROPIC_AUTH_TOKEN`: Anthropic API 的认证 token

## 注意事项

- 确保当前分支的改动已经提交
- 确保 glab 已经配置好 GitLab 访问权限
- 脚本会自动生成合并请求的标题和描述,无需手动输入
``````

## Skill 优化原则

### Agent 思考，脚本执行

根据任务特性，可以划分为不同的自由度等级：

- 高自由度：多种方法均有效，决策结果需结合具体上下文判断，适合 Agent 自主决策。
- 中自由度：存在明确首选执行模式，同时允许少量合理变化，Agent 可在首选模式基础上灵活调整。
- 低自由度：操作流程脆弱、易出错，或对执行一致性要求极高，需严格按固定逻辑执行，避免偏差。

针对低自由度及关键任务，使用脚本执行可解决 Agent 直接执行的痛点，核心优势有四点：

* 不确定性收敛：大模型输出基于概率采样，存在细微差异（比如同样提示词可能用 npm 或 yarn 安装依赖），这种不确定性在关键路径上容易引发隐患，而脚本执行流程固定，避免偏差。
* Token 消耗减少：脚本执行过程不消耗 token，仅在 Agent 处理文本、判断决策时消耗 token，有效降低上下文成本。
* 逻辑复用更高效：脚本可直接调用其他脚本，无需额外权限请求；而 Skill 之间相互调用时，大模型经常需要请求权限，增加执行步骤和耗时。
* 方便调试：脚本可独立运行，加日志，加单元测试，无需依赖 Agent 环境即可排查问题。

### 渐进式披露

Claude 的[技能编写最佳实践](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)核心思想可以总结成一句话：

> 默认假设：Claude 已经非常聪明。只添加 Claude 不知道的上下文。
>
> Default assumption: Claude is already very smart. Only add context Claude doesn't already have.

新增任何信息前，都要问自己：

* “这条信息 Claude 不查看这里也知道吗？”——若是，直接删除。
* “这个内容只在某些场景下才会遇到吗？”——若是，移至 `references/`。
* “这是步骤还是背景？”——若是背景，移至 `references/`；若是步骤，保留在 `SKILL.md`；。

```
SKILL.md（< 500 行）：
  ✅ 核心工作流（每次执行都需要的步骤）
  ✅ 关键命令（带最常用参数）
  ✅ 安全边界（必须注意的约束）
  ❌ 常见问题
  ❌ 常见场景举例
  ❌ 细节参数说明

references/（按需加载）：
  ✅ 参数详细说明
  ✅ 常见问题与最佳实践
  ✅ 故障排查
```

可以看到，优化前的 Skill 存在以下问题：

| 问题类型 | 具体表现 | 优化方式 |
| --- | --- | --- |
| 冗余描述 | 对脚本功能逐条列举，Agent 执行时无需知晓脚本内部功能细节 | 删除 |
| 信息重复 | 在“要求”中已提及 glab CLI 和环境变量，又在“执行步骤”中重申 | 删除重复内容 |
| 防御性写作 | “注意事项”本质是面向人类的提醒，Agent 无需常驻上下文 | 删除或移至 references/ |
| 背景信息 | “智能目标分支选择和 AI 生成的描述”属于背景性内容，非核心步骤 | 移至 references/ |

## 优化后的 Skill

优化后的 Skill 精简明确，通过 [OpenAI Tokenizer](https://platform.openai.com/tokenizer)（GPT-5.x 标准）统计，包含 194 字符、71 token。

| 指标 | 优化前 | 优化后 | 变化 |
| --- | --- | --- | --- |
| 字符数 | 702 | 194 | -72% |
| Token 数 | 311 | 71 | -77% |

``````
---
name: create-merge-request
description: 创建 GitLab 合并请求。在创建 GitLab 合并请求(MR) 时使用。
---

## 创建合并请求

运行以下的脚本：

```bash
bun run .claude/scripts/workflow/create-merge-request.ts
```

不要修改命令或添加额外参数。
``````

## 总结

编写 Skill 的核心思路可归纳为三点：

- 精简优于详尽：只保留 Agent 不知道的上下文，删除 Claude 已经掌握的知识。
- 脚本优于指令：低自由度及关键任务应封装为脚本，由脚本固定执行流程，而非让 Agent 通过自然语言指令逐步推理执行，从而减少不确定性并降低 token 消耗。
- 分层优于平铺：利用渐进式披露机制，将核心步骤放在 SKILL.md 常驻上下文，将背景知识、参数说明、故障排查等内容移至 references/ 按需加载。