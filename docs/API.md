# M0 HTTP API

Base URL：`http://127.0.0.1:4310`。端口可配置。仅本机单用户开发服务，非公共服务 API；没有远程认证或权限管理，不支持反向代理。JSON 请求上限 24 KiB；创建时名称 1–80 字符、需求 1–4000 字符（按 JavaScript string.length）。字段会去除两端空白。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/health` | `{ok:true,version:"0.0.1",stage:"M0"}` |
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
