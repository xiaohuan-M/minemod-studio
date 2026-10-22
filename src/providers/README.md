# 模型适配契约（M1 设计）

**当前只有 mock.mjs 被实现与启用。** `.env.example` 中的 LLM 变量是预留项，填入不会发起模型请求。

## 能力分离

文本规划、代码变更提案、图片生成和 3D 生成使用不同能力标签。首先实现 `planSpec`，接收受控文本上下文，输出经过本地 schema 验证的 ModSpec。不要把自然语言计划当成可执行工具参数。

拟定调用：`planSpec({ prompt, target, previousSpec, signal }) → { spec, assumptions, usage }`。usage 在服务商未返回时为 unknown，不伪造费用。模型身份和基址由服务端受控配置决定，HTTP 请求不得携带任意 URL 或密钥覆盖。

## 首个适配器

OpenAI-compatible 指与常见 chat completions 文本请求形状兼容的服务，而非某个特定 SDK 或所有 OpenAI 功能。逐个验证 JSON 输出、token 字段、取消和错误。可接用户的兼容云服务，也可验证本机 Ollama / LM Studio 的兼容接口；未经实测不写“已支持”。原生厂商协议后续单独适配。

## 必要约束

- 默认 mock。用户显式选择 provider，并确认上下文目的地后才发出请求。
- 密钥服务端管理，不进入项目 JSON、前端、日志、快照或导出。先支持环境变量，UI 持久化须另设计系统密钥链。
- 基址限制 http/https；云端须 HTTPS；localhost HTTP 只用于用户明确配置的本地服务。禁用跨主机重定向携带 Authorization。
- 设定超时、取消信号、响应大小、token 与重试上限。401/403 不自动重试，429 尊重服务商间隔并允许取消。
- 最多两次格式修复；无效数据不能进入工程生成。日志只记录脱敏事件与耗时。
- 开发测试使用假响应；真实调用为显式 opt-in，不能让 CI 产生费用。
