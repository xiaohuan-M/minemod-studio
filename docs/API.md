# HTTP API · M1 开发中

Base URL：`http://127.0.0.1:4310`。端口可配置。仅本机单用户开发服务，非公共服务 API；没有远程认证或权限管理，不支持反向代理。JSON 请求上限 24 KiB；创建时名称 1–80 字符、需求 1–4000 字符（按 JavaScript string.length）。字段会去除两端空白。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/health` | `{ok:true,version:"0.1.0",stage:"M1-in-progress"}` |
| GET | `/api/capabilities` | 阶段、候选目标、mock provider 与已实现能力 |
| GET | `/api/projects` | `{projects:[Project]}`，updatedAt 倒序 |
| POST | `/api/projects` | `{name,prompt}` → 201，返回 Project |
| GET | `/api/projects/:id` | 返回 Project，未知 UUID 为 404 |
| POST | `/api/projects/:id/plan` | 请求 `{}` → 200；替换为离线演示计划 |

POST 必须使用 `Content-Type: application/json`；创建接口拒绝额外字段。演示计划不是生成任务，不支持事件流、费用或工具调用。未提供代码生成、编译、下载或资产接口。

## Project

```json
{
  "schemaVersion": 1,
  "id": "由服务生成的 UUID v4",
  "name": "月光工坊",
  "prompt": "新增月光锤与配方",
  "target": {"edition":"java","loader":"fabric","minecraft":"1.21.1","java":21},
  "status": "draft",
  "plan": null,
  "artifacts": [],
  "createdAt": "ISO-8601 UTC",
  "updatedAt": "ISO-8601 UTC"
}
```

保存演示计划后，status 为 `planned`，plan 有 `provider:"mock"`、`demo:true`、summary、assumptions 和 steps。artifacts 保持空数组。当前状态和目标信息不构成构建或游戏兼容性声明。

## 错误

```json
{"error":{"code":"INVALID_INPUT","message":"项目名称必须为 1–80 个字符。"}}
```

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | INVALID_INPUT / INVALID_JSON / INVALID_ID | 字段、JSON 或 UUID 非法 |
| 403 | HOST_DENIED / ORIGIN_DENIED | Host 不匹配或请求来自其他站点 |
| 404 | NOT_FOUND / PROJECT_NOT_FOUND | 路径或项目不存在 |
| 409 | INVALID_PROJECT_FILE | 项目记录不是普通文件 |
| 413 | BODY_TOO_LARGE | 请求超限 |
| 415 | JSON_REQUIRED | 请求类型不正确 |
| 500 | PROJECT_CORRUPT / INTERNAL_ERROR | 记录损坏或内部故障 |

错误响应不含系统绝对路径、堆栈和密钥。非法路径不读工作区文件；缺少 Origin 的命令行客户端仍可访问，因此此服务不能抵御已在本机运行的恶意程序。

## ModSpec v1

旧 schemaVersion=1 项目保持可读，新增字段默认 revision=0、spec/specSource/specHash/confirmedSpecHash=null；不覆盖旧计划。写操作递增 revision，过时的规格请求返回 409 PROJECT_CHANGED。

| 方法 | 路径 | 请求与结果 |
| --- | --- | --- |
| GET | `/api/schema/mod-spec` | JSON Schema；另有跨字段语义检查 |
| POST | `/api/projects/:id/spec/generate` | `{provider,revision,consent?}` → 离线示例或模型规格 |
| PUT | `/api/projects/:id/spec` | `{spec,revision}` → 校验并保存，清除旧确认 |
| POST | `/api/projects/:id/spec/confirm` | `{revision}` → 确认当前规范化 SHA-256 |
| GET | `/api/projects/:id/spec/export` | 下载已保存的规格 JSON，非模组工程/JAR |

规格保存后 status=awaiting_review，确认后 spec_confirmed。specSource 标记 manual/mock 及 demo；artifacts 仍为空。422 INVALID_SPEC 给出字段路径，409 SPEC_REQUIRED 表示尚无规格。确认不触发生成、构建或网络调用。详见 [规格契约](MODSPEC.md)。

## 自定义 LLM

`GET /api/providers` 返回 mock 和 openai-compatible 的配置状态。已配置模型包含 baseUrl、model、local、timeoutMs、configurationId 和 sends，不包含密钥。未配置时包含可操作的 configurationError，离线模式仍可使用。

- `POST /api/projects/:id/spec/generate`：provider=mock 不联网；provider=openai-compatible 必须携带当前 configurationId 作为 consent，同时提供当前 revision。输入不接受任意基址、模型或密钥。
- `POST /api/providers/openai-compatible/test`：`{consent}`，发送固定测试样例；成功返回 `{ok:true,validatedSpec:true,source}`，不保存项目。
- `POST /api/projects/:id/spec/cancel`：`{}`，返回 `{cancelled:boolean}`。网页可直接终止请求，服务端也会取消对应模型调用。

source 区分 mock/manual/openai-compatible；模型来源含 model、durationMs、usage.inputTokens/outputTokens（未返回则 null），demo=false。未确认规格仍为 awaiting_review。

错误：400 CONSENT_REQUIRED / INVALID_PROVIDER，409 PROVIDER_NOT_CONFIGURED / PLANNING_ACTIVE / PROJECT_CHANGED，429 PROVIDER_RATE_LIMIT / PLANNING_LIMIT，499 PROVIDER_CANCELLED，504 PROVIDER_TIMEOUT，422 PROVIDER_INVALID_SPEC，502 PROVIDER_AUTH / PROVIDER_REDIRECT / PROVIDER_HTTP / PROVIDER_UNREACHABLE / PROVIDER_INVALID_RESPONSE / PROVIDER_RESPONSE_TOO_LARGE。失败不保存新规格，无自动重试。
