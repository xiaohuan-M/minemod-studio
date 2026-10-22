# 开发交接

## 本地环境

1. 安装 Node.js 24+，在仓库根目录运行 `npm ci`。
2. 运行 `npm start`，打开 `http://127.0.0.1:4310`。
3. 新建项目，保存演示计划，停止并重启，确认项目仍存在。
4. 运行 `npm run verify`。内置测试使用临时目录，不接触个人项目。

没有 npm 前端构建步骤、云账号、数据库服务或 API Key 要求。当前实现仅离线演示规划，不需要 JDK。`.env` 仅被 CLI 读取，测试通过参数传入临时目录；不要把个人密钥用于测试。

## 第一项开发任务：ModSpec v1

目标：将自由文本逐步转为可验证、可审查的模组规格。参考 `examples/project-spec.json`，将设计草案转成明确 schema；草案不是当前 API 支持的数据格式。

- 文件建议：`src/core/mod-spec.mjs`、`schemas/mod-spec.v1.schema.json` 与 `test/mod-spec.test.mjs`。
- 首先支持普通物品、中文名称、基础属性及 shaped / shapeless 配方；对命名空间、注册 ID、路径和配方数量设限。
- 未确定的数据放 assumptions；任何可执行脚本都不属于规格字段。
- 覆盖非法路径、版本不匹配、重复 ID、无效配方引用与不受支持能力。
- 更新接口契约后再暴露新的 API；旧项目需要显式迁移或保留 M0 兼容读取。

完成标准：合法样例通过，非法样例给出字段级原因，mock 可以产生受验证规格，UI 显示待确认内容；仍不执行代码。

## 第二项：真实文本 provider

按 `src/providers/README.md` 实现配置读取、连接验证、超时与取消、输出校验及错误脱敏。默认维持 mock，不能仅因为环境中存在通用 API Key 就自动向外发送需求。实测由用户明确选择的服务商完成，记录服务名称、模型和日期，不提交凭据。

## 第三项：模板与 runner 调研

先手工验证固定模板，再开发自动生成。记录 MC、Loader、Fabric API、映射、Loom、Gradle、JDK 与模板提交号，核验 wrapper 完整性和许可证。构建 runner 需要单独 ADR，评估 Windows / macOS / Linux 的隔离与取消行为；缺少隔离时仅导出，不自动执行。

## 验证策略

`npm run check` 对源码、界面脚本、检查脚本及测试运行语法检查。`npm test` 运行 Node 内置测试：输入验证、持久化、损坏记录、符号链接、完整 HTTP 流程、跨站请求、Host、静态文件范围及请求大小。当前测试验证应用骨架，不能证明 Minecraft 模组可用。

`.github/workflows/ci.yml` 在三种桌面系统配置 Node 24 运行 `npm ci` 和 `npm run verify`。Windows 符号链接用例因权限要求跳过，POSIX 分支执行；必须读实际 CI 结果后才能宣称跨平台通过。

## 已知限制

- 本机应用没有用户账户、token 鉴权、远程模式与局域网访问。
- JSON 存储只面向单进程，项目不能同时由多个服务实例写入；临时文件替换不提供断电事务保证。
- 演示规划重复执行会覆盖同一条演示计划；尚无历史版本与导出。
- 数据记录只验证基础版本与 ID，未来导入/迁移必须先增加完整数据验证。
- 尚无真正的 provider、模板、Gradle runner、游戏测试或资产编辑能力。
