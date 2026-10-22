# 参与开发

先阅读 README、AGENTS.md 和 docs/DEVELOPMENT.md。使用 Node.js 24+，运行 `npm ci` 与 `npm run verify`。

围绕一个可验证的行为提交 PR，说明解决的问题、最终行为、验证结果与限制。新增能力同步更新 capabilities 和文档；涉及真实构建时附目标清单、脱敏日志与产物校验和。

默认不引入新依赖。确有必要时说明原因，保留 lockfile 并确认许可证。不要提交 API Key、个人工程、Minecraft 游戏文件、生成的二进制或未获授权素材。不要伪造模型、构建与游戏验证结果。

发现普通问题使用 Bug 模板；功能提议说明使用场景与验收方式。安全问题按 SECURITY.md 处理。
