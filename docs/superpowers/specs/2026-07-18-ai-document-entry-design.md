# AI 协作文档入口设计

## 目标

将 `AGENTS.md` 设为 Codex 与 Claude 共用的协作规则唯一来源，同时保留 `PROJECT_SPECS.md`
作为项目事实唯一来源，并在 `README.md` 中说明各文档职责、引用关系和维护方式。

## 文档职责

| 文档               | 职责                                     | 主要读者              | 维护原则                                           |
| ------------------ | ---------------------------------------- | --------------------- | -------------------------------------------------- |
| `README.md`        | 项目介绍、启动方式、文档导航             | 开发者、部署人员      | 只提供入口和概览，不复制完整规则或架构事实         |
| `AGENTS.md`        | 编码、验证、提交和产物管理等公共协作规则 | Codex、Claude、开发者 | 作为 AI 协作规则唯一来源，公共规则只在此维护       |
| `CLAUDE.md`        | Claude Code 入口及 Claude 专属导航       | Claude Code           | 通过 `@AGENTS.md` 导入公共规则，不重复维护公共规则 |
| `PROJECT_SPECS.md` | 当前架构、技术栈、产品边界和部署事实     | 所有参与者            | 作为项目事实唯一来源，不承载 AI 行为规则           |

## 引用关系

```text
README.md
├── AGENTS.md             公共协作规则入口
├── PROJECT_SPECS.md      项目事实入口
└── CLAUDE.md             Claude Code 专属入口
    └── @AGENTS.md        实际导入公共协作规则

AGENTS.md
└── PROJECT_SPECS.md      规则执行时所依据的项目事实
```

Codex 按仓库约定自动读取 `AGENTS.md`。Claude Code 打开 `CLAUDE.md` 时，通过 `@AGENTS.md`
导入同一份规则。因此提交语言、修改后提交、环境文件保护、日志与截图目录等公共要求只需要在 `AGENTS.md`
中维护一次。

Markdown 普通链接只负责导航，不等同于 Claude Code 的文件导入。`CLAUDE.md` 必须保留明确的
`@AGENTS.md` 导入语句，不能只写 `[AGENTS.md](./AGENTS.md)` 链接。

## 内容调整

### `AGENTS.md`

- 在文档结构附近明确其为 Codex 与 Claude 的公共协作规则入口。
- 说明 Claude Code 通过 `CLAUDE.md` 导入本文件。
- 保留现有编码、验证、Git 中文提交、修改后必须提交和本地产物管理规则。
- 继续引用 `PROJECT_SPECS.md`，不把架构事实复制进公共规则。

### `CLAUDE.md`

- 在文件顶部加入 `@AGENTS.md`，使 Claude Code 实际加载公共规则。
- 明确公共规则以 `AGENTS.md` 为准、项目事实以 `PROJECT_SPECS.md` 为准。
- 删除与 `AGENTS.md` 重复的“开发约定”、日志和截图规则。
- 保留 Claude 使用时有帮助的快速开始、常用命令和代码导航；其中的易变项目事实改为指向
  `PROJECT_SPECS.md`，避免形成第二份事实源。
- 当前工作区中尚未提交的“修改并验证后必须提交，且提交使用中文”要求已经存在于 `AGENTS.md`，抽离时删除
  `CLAUDE.md` 的重复文本，不丢失规则本身。

### `README.md`

- 增加“文档职责与 AI 规则”说明。
- 用表格说明四份文档各自负责什么，以及公共规则和项目事实应修改到哪里。
- 说明 Codex 直接使用 `AGENTS.md`，Claude Code 通过 `CLAUDE.md` 导入 `AGENTS.md`。
- 不在 README 中复制具体 Git、环境或测试规则，避免后续出现多份不一致内容。

### `PROJECT_SPECS.md`

- 保持共享项目事实源定位。
- 仅在现有说明无法表达与 `AGENTS.md` 的边界时调整入口文字，不迁入协作规则。

## 规则优先级

出现描述冲突时按以下顺序处理：

1. 用户在当前任务中的明确要求。
2. `AGENTS.md` 中的公共协作规则。
3. `PROJECT_SPECS.md` 中的当前项目事实。
4. `README.md` 和 `CLAUDE.md` 中的导航或快速使用说明。

发现低优先级文档与高优先级来源不一致时，应修正低优先级文档，而不是在多个文件中继续维护同一条规则。

## 验证标准

- `CLAUDE.md` 包含有效且唯一的 `@AGENTS.md` 导入。
- `CLAUDE.md` 不再重复 Git 中文提交、修改后提交、日志目录和截图目录等公共规则。
- `README.md` 能清楚回答“项目事实改哪里”和“AI 公共规则改哪里”。
- `AGENTS.md` 明确声明其公共规则入口身份，并继续指向 `PROJECT_SPECS.md`。
- 四份文档之间没有循环导入；普通 Markdown 导航链接不视为导入。
- 修改后的 Markdown 通过仓库格式检查，提交信息使用中文。

## 范围外事项

- 不改变应用代码、构建流程或运行时行为。
- 不新增第五份公共规则文件。
- 不把 `README.md` 或 `PROJECT_SPECS.md` 改造成 AI 指令入口。
