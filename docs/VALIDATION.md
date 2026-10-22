# M0 验证记录

日期：2026-10-22。环境：Linux，Node.js v24.19.0，Python 不是项目运行依赖。

已执行：

- `npm install --package-lock-only --ignore-scripts --offline`：生成零第三方依赖的锁文件。
- `npm ci --ignore-scripts --offline`：通过。
- `npm run verify`：JavaScript 语法检查通过，10 项测试通过，0 失败、0 跳过。

覆盖：项目输入与 ID 校验、mock 不伪造产物、持久化和重新读取、损坏记录、符号链接拒绝、HTTP 项目流程、JSON 与大小限制、Origin、Host、静态文件白名单和 CSP。

未验证：远程 CI、Windows / macOS 实机运行、浏览器视觉与交互验收、真实模型调用、Fabric 工程、Gradle 构建、Minecraft 游戏行为。这些不能由本次基础测试推断。

此文件记录初始基线。后续工作应按实际运行结果更新，不修改历史描述来宣称未执行的检查。
