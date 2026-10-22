# MineMod Studio · 本地模组工坊

**开源、本地优先的 AI Minecraft 模组创作工具。** 用自然语言表达玩法，逐步完成规划、工程生成、资源制作、真实构建和导出；工程与模型配置由用户掌握。

> **当前阶段：M0 / 开发前基础，版本 0.0.1。** 已有可运行的本地项目壳与离线演示规划。尚不能用 AI 生成模组、编译 JAR 或操作 Blockbench。所有未来能力在文档中明确列为待开发。

本项目参考 [AutoMods 的公开产品流程](https://automods.cn/#faq)，独立编写代码、文档和界面。不是其源码开源版或官方客户端，不复制其品牌、界面素材或私有实现。与 Mojang、Microsoft 无关联。

## 现在可以做什么

- 在本机创建、保存和重新打开项目；JSON 数据默认保存在 `.minemod/projects/`。
- 查看离线演示计划，理解后续制作步骤；演示不会调用模型或产生费用。
- 使用能力接口核对实现状态；构建、贴图、模型与 JAR 导出均标记为未实现。
- 运行核心验证、持久化测试和 HTTP 边界测试。

## 快速开始

需要 **Node.js 24 或更高版本**，Windows / macOS / Linux 均为计划支持平台。当前已在 Linux + Node.js 24 验证；跨平台 CI 配置随仓库提供，需等待远程执行结果。

```sh
git clone https://github.com/xiaohuan-M/minemod-studio.git
cd minemod-studio
npm ci
npm start
```

浏览器打开 **http://127.0.0.1:4310**。`npm ci` 当前没有第三方依赖要下载。按 Ctrl+C 停止服务。必须使用 `127.0.0.1`，当前不接受 `localhost`、局域网地址或反向代理。

可选：复制 `.env.example` 为 `.env`，修改端口或数据目录。macOS / Linux 使用 `cp .env.example .env`；PowerShell 使用 `Copy-Item .env.example .env`。首次启动自动创建数据目录。不要把 `.env` 和个人工程提交进 Git。

```sh
npm run verify
```

JDK 和 Gradle **不是运行当前开发骨架的前提**。后续模组构建目标是 Fabric / Minecraft 1.21.1 / JDK 21；只有经模板构建和游戏实测后才能标记为支持。

## 接下来怎么开发

建议按下面顺序阅读，直接从 [开发交接](docs/DEVELOPMENT.md) 中的第一个任务开始。

| 文档 | 内容 |
| --- | --- |
| [产品需求](docs/PRD.md) | 用户、首个闭环、MVP 范围与验收 |
| [参考与范围判断](docs/REFERENCE.md) | 公开来源、哪些值得借鉴、哪些推迟 |
| [架构](docs/ARCHITECTURE.md) | 当前模块、目标架构、工程边界 |
| [接口契约](docs/API.md) | 已实现 HTTP API、错误与数据约定 |
| [路线图](docs/ROADMAP.md) | 里程碑、依赖、退出标准 |
| [开发交接](docs/DEVELOPMENT.md) | 环境、任务拆解、下一步实现说明 |
| [模型接入契约](src/providers/README.md) | 自带 API、本地模型与费用确认设计 |
| [决策记录](docs/adr/0001-local-first.md) | 为什么先做本地服务和单一版本 |
| [工程示例](examples/project-spec.json) | 下一阶段规格示例；不是已生成模组 |

## 目录

```text
src/core/       项目领域规则、能力声明、错误
src/storage/    本地 JSON 持久化
src/providers/  离线演示规划器、后续模型适配契约
src/server.mjs  仅监听回环地址的 HTTP 服务
src/cli.mjs     本地启动入口
web/           无构建步骤的界面壳
test/          Node 内置测试
docs/          产品、架构、路线图和开发说明
examples/      非可执行的规格样例
```

## 本地与离线的边界

本地优先表示工程保存在本机。M0 没有外部网络调用。未来选择云模型会把用户明确提交的需求和必要上下文发给指定服务商，并由该服务商计费；选择本地模型也不保证模型质量或模组构建完全离线。JDK、Gradle、Minecraft 依赖首次安装通常需要联网。

构建脚本属于可执行代码。未来构建必须经过差异审查和明确授权，并使用独立运行目录、资源上限和受限环境。当前不执行任何生成代码，也不读写真实游戏目录。详见 [安全说明](SECURITY.md)。

## 参与与许可证

代码采用 [MIT](LICENSE)。贡献前阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。第三方模板、依赖、素材保留各自许可证；项目许可证不覆盖 Minecraft 的代码与资产，也不保证模型输出的权利归属。
