# 自带 LLM · Chat Completions 适配器

已实现 `mock.mjs` 和 `openai-compatible.mjs`。默认 mock；配置文件不会自动触发模型请求。Node.js >=24.5，使用原生 fetch，依赖通过 package-lock.json 固定；文本协议使用原生 fetch。

## 服务端配置

将 `.env.example` 复制为未跟踪的 `.env`，填写并重启 `npm start`。

| 变量 | 含义 / 默认 |
| --- | --- |
| MINEMOD_LLM_BASE_URL | 接口基址，例如 https://你的服务/v1；程序追加 chat/completions |
| MINEMOD_LLM_MODEL | 服务商定义的模型 ID |
| MINEMOD_LLM_API_KEY | 服务端密钥；云端必需，本机可省略 |
| MINEMOD_LLM_TIMEOUT_MS | 45000；允许 1000–120000，覆盖请求和响应读取 |
| MINEMOD_LLM_MAX_TOKENS | 4096；允许 256–8192，使用 max_tokens 请求字段 |
| MINEMOD_LLM_TOKEN_FIELD | max_tokens；支持需要 max_completion_tokens 的服务 |
| MINEMOD_LLM_JSON_MODE | true；服务不支持 response_format=json_object 时设 false |

云端必须 HTTPS。本机可用 http://localhost、http://127.0.0.1、http://[::1]；基址不接受 URL 用户名/密码、查询参数或片段。不跟随重定向。`npm start` 开启 Node 的环境代理支持，使用现有 HTTPS_PROXY / HTTP_PROXY / NO_PROXY 和 CA 信任；不关闭 TLS 校验。在托管环境中还需允许实际服务商域名，并通过环境设置安全提供凭据，不能把密钥发到聊天中。

## 调用与确认

网页只显示脱敏的配置元信息，不接受 URL/密钥覆盖，也不保存 API Key。切换到“我的 LLM API”后显示目的地址、模型以及将发送的项目名称、需求文本、目标版本、当前规格和修改要求；勾选确认后才能发起生成。每次调用结束会重置确认。服务重启会变更 configurationId，旧页面须刷新。

连接测试同样需要确认，会向所选模型发送固定样例，验证返回的 ModSpec，不包含项目内容，也可能计费。测试通过不代表玩法质量、全协议或其他模型兼容。

适配器发送 system schema + 受控 user JSON，使用非流式 Chat Completions，不发送任意项目文件或密钥作为模型上下文。持续修改会发送已有规格；只有用户选定失败构建后，才附加日志末尾最多 6000 字。不支持原生 Anthropic/Gemini 协议、Responses API、工具调用和图片输入。素材生成使用同一文本接口输出受限像素数组或立方体数据；素材描述单独发送，返回后先载入编辑器审查，不自动绑定或构建。允许纯 JSON 或完整 JSON 代码围栏；通过结构和语义校验后才保存。响应最多 128 KiB，最终规格最多 20 KiB。未知 token 数标为未知，不估算费用。

## 错误、取消和并发

401/403、429、重定向、无效 JSON、非法规格、超限、超时分别给出可操作的中文错误，响应正文和认证信息不进入日志或错误。没有自动重试或自动格式修复（上限为 0 次），避免额外计费；429 提示尊重 Retry-After 后再手动重试。

可取消请求，断开网页请求也会中止服务端 fetch；第三方仍可能完成或计费。失败/取消不覆盖原规格。每个项目只允许一个模型请求，整个服务最多两个；请求返回后重新核对 revision，避免覆盖生成期间的人工修改。再次生成或手工编辑会清除旧确认，仍不执行任何代码。

## 验证范围

CI 使用本机假服务验证真实 HTTP 请求形状、认证头、JSON 模式、输出校验、错误脱敏、限流、响应体超时、取消、重复请求和并发冲突，不使用用户密钥或产生模型费用。尚未完成真实云模型或 Ollama / LM Studio 的端到端实测；需按用户明确选择的基址、模型和安全配置的密钥单独验证。

## 素材与诊断的限制

像素和立方体生成不是专业图像/3D 服务；验证确保数据形状可用，不保证美术质量或许可。导入/编辑仍可离线完成。失败日志分析只能生成受支持的规格修正，不会自动改 Gradle、安装依赖或修补模板。模板错误应由开发者修复后重新真实编译验证。
