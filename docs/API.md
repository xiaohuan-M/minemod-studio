# HTTP API · 0.2

Base URL：`http://127.0.0.1:4310`。端口可配置。仅本机单用户开发服务，非公共服务 API；没有远程认证或权限管理，不支持反向代理。JSON 请求上限 24 KiB；创建时名称 1–80 字符、需求 1–4000 字符（按 JavaScript string.length）。字段会去除两端空白。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/health` | `{ok:true,version:"0.2.0",stage:"Fabric-workshop-preview"}` |
| GET | `/api/capabilities` | 阶段、候选目标、mock provider 与已实现能力 |
| GET | `/api/projects` | `{projects:[Project]}`，updatedAt 倒序 |
| POST | `/api/projects` | `{name,prompt}` → 201，返回 Project |
| GET | `/api/projects/:id` | 返回 Project，未知 UUID 为 404 |
| POST | `/api/projects/:id/plan` | 请求 `{}` → 200；替换为离线演示计划 |

POST 必须使用 `Content-Type: application/json`；创建接口拒绝额外字段。演示计划不是生成任务，不支持事件流、费用或工具调用。工程、构建与素材接口见下文。

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
| POST | `/api/projects/:id/spec/generate` | `{provider,revision,consent?,instruction?,repairBuildId?}` → 离线示例或模型规格 |
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

## 规格历史

每次成功编辑、重新生成或恢复前，将当前规格（含来源、SHA-256、当时确认状态、时间、revision）一并写入项目 JSON，保留最近 20 个被替换版本。失败不会添加历史。项目响应返回 historyCount，不内嵌历史内容。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/projects/:id/spec/history` | `{history,limit:20}`；倒序元信息，不包含完整规格 |
| GET | `/api/projects/:id/spec/history/:revision` | 单个历史快照和完整规格 |
| POST | `/api/projects/:id/spec/restore` | `{fromRevision,revision}`；恢复旧规格并保留被替换版本 |

恢复要求当前 revision，过时请求返回 409 PROJECT_CHANGED；丢失/已过保留上限的版本返回 404 SNAPSHOT_NOT_FOUND。恢复清除旧确认并标记 specSource.restoredFromRevision；不调用模型、不执行构建。读取时验证当前及历史规格哈希，损坏记录返回 500 PROJECT_CORRUPT 并保留原文件。

## 持续修改与素材生成

`spec/generate` 可增加 `instruction`（最多 4000 字）和 `repairBuildId`。仅允许附加本项目 failed 构建的日志末尾最多 6000 字；当前规格作为上下文一起发送。规格仍完整校验并通过 revision 检查后才保存，不直接修改源码或重跑构建。

`POST /api/providers/openai-compatible/asset` 请求 `{consent,kind:"texture"|"model",prompt}`（1–2000 字），返回 `{kind,data,source}`。只发送素材描述；结果经校验后返回，不自动入库。断开请求会中止对应模型调用。与规格请求共享最多两个并发请求限制，同一素材生成任务不重复启动。

## 素材

| 方法 | 路径 | 请求/结果 |
| --- | --- | --- |
| GET | `/api/assets` | 元数据列表，不包含像素/模型正文 |
| POST | `/api/assets` | `{name,kind,data,source,license,format?}` → 不可变新资源；请求最多 1 MiB |
| GET | `/api/assets/:id` | 完整资源、哈希与来源 |
| GET | `/api/assets/:id/png` | 贴图 PNG 下载 |
| GET | `/api/assets/:id/bbmodel` | 静态模型 bbmodel 下载；含占位纹理，用户贴图单独导出绑定 |

texture data 为 `{width,height,pixels}`，边长 16/32/64，每个像素 `#RRGGBBAA`；model data 为 Java 立方体 `elements`，最多 128 个。`format:"bbmodel"` 将受限静态模型转为规范形式。不接受 mesh、动画或组变换。

## 工程与交付

| 方法 | 路径 | 请求/结果 |
| --- | --- | --- |
| GET | `/api/examples/full-workshop` | 完整支持内容的规格示例 |
| POST | `/api/projects/:id/clone` | `{}` → 新项目副本，确认清空 |
| POST | `/api/projects/:id/import` | `{spec,revision}` → 与 PUT spec 相同的验证/历史规则 |
| GET | `/api/projects/:id/workspaces` | 工程快照元数据列表 |
| POST | `/api/projects/:id/workspaces` | `{revision}` → `{project,workspace}`，要求已确认规格 |
| GET | `/api/projects/:id/workspaces/:hash` | 文件元数据、差异、模板信息 |
| GET | `/api/projects/:id/workspaces/:hash/file?path=...` | 快照中精确匹配的文本文件；不读任意磁盘路径 |
| GET | `/api/projects/:id/workspaces/:hash/source` | 完整源码 ZIP |
| POST | `/api/projects/:id/workspaces/:hash/approve` | `{revision}` → 批准当前快照 |
| GET | `/api/builder` | 实际 Docker / 镜像状态（无下载） |
| POST | `/api/builder/prepare` | `{allowNetwork:true}` → 202 镜像准备任务 |
| GET | `/api/projects/:id/builds` | 此项目构建元数据，不含日志正文 |
| POST | `/api/projects/:id/builds` | `{revision,snapshotHash,allowNetwork:boolean}` → 202；要求当前工程已批准 |
| GET | `/api/builds/:id` | 状态、真实日志、模板/工程/runner 哈希与产物元数据 |
| POST | `/api/builds/:id/cancel` | `{}` → 请求取消 |
| GET | `/api/builds/:id/jar` | 成功且哈希匹配的 JAR |
| GET | `/api/builds/:id/report` | 构建报告 JSON |
| GET | `/api/builds/:id/bundle` | 源码 + 已校验 JAR + 报告 + 安装说明 ZIP |

`workspaceHash` 指向当前工程；`approvedWorkspaceHash` 是批准的工程哈希。规格修改/恢复清空这两个字段，但不删除旧快照。`lastWorkspaceHash` 用于与上次工程比较。生成、批准同样递增项目 revision。旧 Project.artifacts 字段为兼容保留，构建产物以 builds 接口为准。

构建状态：queued / running / passed / failed / cancelled / timed_out / interrupted。全局最多一项镜像准备或构建任务。日志上限 256 KiB；passed 构建仍 `gameTested:false`。未通过的任务不能下载 JAR；旧通过任务仍可下载。

常见错误：409 SPEC_UNCONFIRMED / WORKSPACE_CHANGED / BUILD_APPROVAL_REQUIRED / BUILD_ACTIVE / ARTIFACT_UNAVAILABLE，422 INVALID_ASSET / ASSET_MISSING / UNSAFE_PATH，500 WORKSPACE_CORRUPT / ASSET_CORRUPT。能力接口声明实现情况，环境是否就绪需查询 `/api/builder`，不能把 gradleBuild=true 当作 Docker 已安装。

## 多目标适配

`GET /api/targets` 返回 `id/label/target/artifact/features/validation/enabled`。新建项目可传 `targetId`；省略时保持 `fabric-1.21.1`。可用目标：`fabric-1.21.1`、`fabric-1.20.1`、`bedrock-1.21.60`（java=0 表示不适用）。版本、加载器与 Java 必须成套匹配。`GET /api/examples/full-workshop?target=<id>` 返回该目标的内置示例。

构建接口沿用快照批准流程。Bedrock 在本机打包，无需 Docker、镜像或联网。`GET /api/builds/:id/artifact` 下载该任务的 JAR 或 MCADDON；旧 `/jar` 保留，仅接受 JAR。报告的 `artifact.format` 明确类型，`gameTested` 保持 false。`bundle` 包含目标对应安装说明。

## 持续创作与项目管理

`POST /api/projects/:id/proposals` 接受 `{revision,provider,consent?}`，返回保存了 2–4 个方案的项目，每个方案含玩法、美术、验收与后续修改指令。真实服务遵循相同逐次授权、取消与并发限制。采用方案只填入修改文本，不静默调用 API。

成功的规格生成在同一次原子项目写入中追加 `conversation`（最近 100 条），保存用户要求、校验后摘要、来源、token 用量、版本和 specHash。后续 LLM 调用只附加最近 12 条的需求与摘要，不发送任意本地字段。失败或过期响应不能覆盖当前规格或聊天记录。

`PATCH /api/projects/:id` 接受 `{revision,name?,archived?}`。归档可恢复，不删除历史或产物。

## 项目备份

`GET /api/projects/:id/backup` 下载版本 1 的 `.minemod.json`（最多 32 MiB），包含当前规格、20 个规格历史、100 次创作记录、关联素材、工程快照和构建记录/成功产物。包含需求和对话，请自行决定是否分享；不包含服务密钥、.env、缓存或依赖。

`POST /api/projects/import-backup` 上传该 JSON，校验 checksum、每个素材/工程/产物哈希和引用，然后在临时目录完成验证、以新项目 ID 提交。同 ID 素材仅在内容与归属信息一致时复用；不覆盖已有项目。当前确认与批准清除。导入构建标记 imported，并且不能直接执行导入工程：必须重新确认规格、经本机生成器生成并审查后才可构建。外部报告并非本机编译证明。

## 独立图像服务

`GET /api/image-provider` 仅返回公开配置；`POST /api/image-provider/generate` 接受 `{consent,prompt,view,referenceId?}`，view 为 concept/three_view/detail/texture。只会发送选中的本地图片作为参考，使用 Images generations 或 multipart edits。返回经过 PNG 尺寸/CRC 校验的图片；响应 URL 不自动访问。不与文本 LLM 共用或隐式推断凭据。

资源新增 kind=image，data={png:base64}，要求 16–2048 像素且原 PNG 不超过 6 MiB。图片请求体上限 9 MiB，其他素材仍为 1 MiB。`GET /api/assets/:id/png` 下载；`POST /api/assets/:id/pixelize` 接受 `{size:16|32|64,colors:4|8|16|32|64}`，在本地缩放、量化调色板并创建可继续编辑的贴图，沿用原来源和许可。

## 共享素材与开放目录

`GET /api/catalog` 提供随源码分发的原创素材目录，`POST /api/catalog/:id/import` 接受空对象并导入整组素材。目录来源、许可与贡献流程见 community/README.md。

`GET /api/asset-packages` 导出整个资源库；`GET /api/assets/:id/package` 导出单项资源。`POST /api/asset-packages` 导入版本化 JSON，验证所有记录与 checksum 后创建新资源 ID；保留来源/许可，不覆盖本机素材。

`POST /api/blockbench/export` 接受 `{model,texture?,name,kind?}`，kind 默认 model，可选 animated_model，返回含嵌入 PNG 的 bbmodel。`POST /api/blockbench/import` 接受 `{model,name,source,license}`，根据动画内容导入静态或动画立方体与嵌入 PNG；拒绝外部纹理路径，纹理限 16/32/64 方形。动画只接受每个根骨骼一个立方体、数字线性关键帧；嵌套骨骼、网格、表达式和组旋转不在该接口范围内。

目标新增 `forge-1.20.1` 与 `neoforge-1.21.1`，均通过完整内容样例编译。`GET /api/builder?target=<id>` 检查该目标的固定镜像；准备镜像 POST 可传 `targetId`。Forge 使用 JDK17，其他当前 Java 目标使用 JDK21 编译器。`GET /api/registries/items?target=<id>` 返回该游戏版本的原版物品 ID；保存/生成时拒绝未知原料。旧项目仍可打开并修正旧引用，不因为新增规则丢失历史。

## 动画与视觉参考

素材新增 kind=animated_model，data 为 `{elements,clips}`。每个立方体对应一个独立根骨骼；最多 8 个片段、每段 0.1–30 秒、每段合计 512 个线性关键帧。片段轨道按 bone 索引保存 rotation/translation/scale；规范化须幂等，以保持备份与哈希一致。`GET /api/assets/:id/bedrock` 导出 geometry、animation、来源信息和占位贴图 ZIP。`/bbmodel` 同时支持动画模型。

Bedrock 实体可引用 modelAsset（model 或 animated_model）和 animationClip；未绑定时使用原创立方体角色与 walk 动画。生成器输出实体行为、client entity、几何、动画、渲染控制器和刷怪蛋，打包时检查引用。Java 实体仍使用原版原型，不接受这些自定义模型/动画字段。Bedrock 不接受 Java rescale 和 UV 面旋转。

`POST /api/providers/openai-compatible/asset` 可增加 `referenceId`。只发送用户明确选中的 image 资源，以 Chat Completions image_url/data URI 传递；需要供应商模型支持视觉输入。未选择图片时保持纯文本协议；真实视觉服务按用户要求未联调。
