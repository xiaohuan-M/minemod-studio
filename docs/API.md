# HTTP API · 0.14

0.14：四 Java 目标的实体可绑定静态或层级动画 modelAsset，animationClip 必须存在于该模型。固定包内渲染器和模型数据在 AI 可编辑命名空间之外；不绑定自定义模型时保留原版 64×64 UV 约束。自定义模型可使用 16/32/64，显式贴图优先，动作规则和物理限制见 MODEL-FORMAT.md。

0.13：内容对象可选 `texturePrompt` / `modelPrompt`（非空、最多 2000 字，遵守目标支持范围）。自动规划改变要求或贴图颜色时以现有素材为上下文创建新素材；单纯重命名保留绑定。任务选项 `refreshMaterials` 默认 false，true 时重新制作本轮启用种类的已有素材，恢复保留这个策略。仅更新贴图会本地合成新的模型内置贴图，不额外调用几何模型。手工保存要求后需选择重制，因为本轮起点已经包含手工修改。

素材可有 `derivedFrom` 来源摘要（最多 64 项：id/name/kind/sha256/source/license），资源包、备份和源码保持它；不包含模型提示词、密钥或可执行链接。摘要为声明，不提供权利证明或跨账户访问能力。后续同种素材修改保留根来源，首次跨种组合保留对应贡献来源。

## 自动创作与完整作品版本

0.7 策略增加 `code`（默认 true，Java 有效）：生成工程后检索匹配版本资料，让所选模型修改本模组 Java/JSON，随后编译；失败后在原工程上按日志修复。只允许指定命名空间、最多 24 个文件/128 KiB；禁止改脚本、依赖、入口元数据和宿主接口，编译关闭注解处理器。`allowNetwork` 同时控制固定文档源获取；离线可使用经过哈希校验的缓存。任务事件记录资料来源、修改说明与文件差异。源码数据约束不构成游戏行为正确性的证明。

## 持续素材会话

0.8 的模型数据可含 `texture`（现有 RGBA 像素格式）。会话 generate 新增 withTexture（默认 true）和 regenerateTexture（默认 false）：模型缺贴图时自动再请求一次像素贴图；后续几何修改默认保留原图，只有明确选择才重新绘制。一次请求最多两次模型调用，用量合并记录；生成期间会话写入/恢复被拒绝。数据保存、bbmodel 导入导出、独立 Bedrock 下载及生成模组都保留贴图。内容对象明确绑定 textureAsset 时，优先于模型内贴图。

`GET/POST /api/asset-sessions` 列表/创建（kind=texture/model/animated_model、name）；`GET /api/asset-sessions/:id` 返回当前素材、revision 和历史；`POST .../generate` 接收 revision、prompt、consent、可选 currentData/referenceId，明确发送当前素材和最近 12 条要求后生成并自动保存不可变素材。`POST .../restore` 接收 revision、assetId，不调用模型，恢复本会话已有结果。最多 100 个会话，每个保留最近 100 条记录；资源库原有限额仍生效。请求最多 256 KiB。

像素生成额外支持 `{width,height,palette,runs:[[paletteIndex,count],...]}`，校验后转换为现有 RGBA 格式；不会将新传输格式写入旧素材记录。当前尺寸在继续编辑时必须保留。动画包含兼容旧平级格式的可选层级骨骼，详见 MODEL-FORMAT.md；真实模型效果未验。

`POST /api/creations` 从一句需求新建并自动制作；接收 prompt、可选 name/targetId 和本轮策略。`POST /api/projects/:id/creations` 在已有项目继续，另需 revision、可选 instruction。策略为 consent（当前文本配置标识）、approved=true、textures/models（默认 true）、maxCalls（1–256，默认 48）、maxRepairs（0–3，默认 2）、allowNetwork（默认 false）。授权涵盖本轮模型、素材与具体工程构建；不允许覆盖任务的服务地址或密钥。

`GET /api/projects/:id/creations` 列出任务；`GET /api/creations/:taskId` 包含顺序事件、模型调用与用量、素材、工程、构建及完整版本 ID。`POST /api/creations/:taskId/cancel` 接受空对象；`POST .../resume` 接收当前 revision、consent、approved=true，继续未完成步骤，不重置已用额度；可显式提交更高 maxCalls/maxRepairs 和新的 allowNetwork，重新确认剩余步骤。配置更改、并发项目编辑和旧 revision 被拒绝。刷新页面不会取消任务；真实模型错误/构建失败不会被标为成功。

`GET /api/projects/:id/versions` 列出完整作品版本；`POST` 接收 revision、可选 label 保存；`GET .../versions/:versionId` 返回带校验值的完整项目状态与素材/工程/构建关联清单；`POST .../versions/:versionId/restore` 接收 revision。恢复前自动存档，恢复该轮需求/会话/规格/素材绑定和工程关联，推进 revision 并清除执行批准；旧产物继续独立可下载。完整备份包含这些版本，导入后重映射身份并保持外部工程不可直接执行。

Base URL：`http://127.0.0.1:4310`。端口可配置。仅本机单用户开发服务，非公共服务 API；没有远程认证或权限管理，不支持反向代理。JSON 请求上限 24 KiB；创建时名称 1–80 字符、需求 1–4000 字符（按 JavaScript string.length）。字段会去除两端空白。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/health` | `{ok:true,version:"0.8.0",stage:"multi-target-workshop-preview"}` |
| GET | `/api/capabilities` | 阶段、候选目标、mock provider 与已实现能力 |
| GET | `/api/projects` | `{projects:[Project]}`，updatedAt 倒序 |
| POST | `/api/projects` | `{name,prompt,targetId?}` → 201，返回 Project |
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

`POST /api/providers/openai-compatible/asset` 请求 `{consent,kind:"texture"|"model",prompt}`（1–2000 字），返回 `{kind,data,source}`。发送素材描述与明确选定的可选图片参考（见末节）；结果经校验后返回，不自动入库。断开请求会中止对应模型调用。与规格请求共享最多两个并发请求限制，同一素材生成任务不重复启动。

## 素材

| 方法 | 路径 | 请求/结果 |
| --- | --- | --- |
| GET | `/api/assets` | 元数据列表，不包含像素/模型正文 |
| POST | `/api/assets` | `{name,kind,data,source,license,format?}` → 不可变新资源；请求最多 1 MiB |
| GET | `/api/assets/:id` | 完整资源、哈希与来源 |
| GET | `/api/assets/:id/png` | 贴图 PNG 下载 |
| GET | `/api/assets/:id/bbmodel` | 静态/动画模型 bbmodel 下载；默认含占位纹理，用户贴图可通过 blockbench/export 嵌入 |

texture data 为 `{width,height,pixels}`，边长 16/32/64，每个像素 `#RRGGBBAA`；model data 为 Java 立方体 `elements`，最多 128 个。`format:"bbmodel"` 将受限静态模型转为规范形式。静态 kind=model 不接受 mesh、动画或组变换；动画 kind=animated_model 见末节。

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

`GET /api/targets` 返回 `id/label/target/artifact/features/validation/enabled`。新建项目可传 `targetId`；省略时保持 `fabric-1.21.1`。可用目标：`fabric-1.21.1`、`fabric-1.20.1`、`forge-1.20.1`、`neoforge-1.21.1`、`bedrock-1.21.60`（java=0 表示不适用）。版本、加载器与 Java 必须成套匹配。`GET /api/examples/full-workshop?target=<id>` 返回该目标的内置示例。

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

## 网页服务设置 · 0.4

| 方法 | 路径 | 请求与结果 |
| --- | --- | --- |
| GET | `/api/settings/providers` | revision、active.text/image、脱敏 profiles、environment 回退公开信息、limit=20 |
| POST | `/api/settings/providers` | `{revision,name,kind,baseUrl,model,apiKey?,options?}`，新建配置 → 201；不自动启用 |
| PUT | `/api/settings/providers/:id` | 同上；kind 不可改，apiKey 省略保留原值，空字符串清除 |
| POST | `/api/settings/providers/activate` | `{revision,kind,profileId}`，kind=text/image；profileId=null 切回启动环境 |
| DELETE | `/api/settings/providers/:id` | `{revision}`；禁止删除正在启用的配置 |

公开 profile 为 id/name/kind/baseUrl/model/options/updatedAt/hasApiKey，不包含密钥。文本 options 为 timeoutMs=1000–120000、maxTokens=256–8192、jsonMode:boolean、tokenField=max_tokens|max_completion_tokens；图像 options 为 timeoutMs=1000–180000、responseFormat=b64_json|auto。未填写采用默认值，编辑省略 options 保留原选项。远程 HTTPS 需密钥，本机 HTTP 可免密。

所有写操作都需当前设置 revision，与项目 revision 独立。409 SETTINGS_CHANGED 表示其他页面已修改；409 PROVIDER_REQUEST_ACTIVE 表示模型请求运行中；409 PROFILE_IN_USE 表示不可删除启用项；422 INVALID_PROVIDER_PROFILE / PROFILE_LIMIT / PROFILE_NOT_FOUND 表示数据或选择不正确。所有成功设置修改都更新调用配置标识，旧 consent 返回 400。更改/保存不会调用服务，也不覆盖 .env。

设置为本机私有文件，重启保留；不在项目/资源备份、源码或发行包中。首次输入密钥经本机 HTTP 提交，后续 GET 从不回传；此服务仍仅允许回环使用，不能直接作为公开站点后端。

## 掉落编辑 · 0.8

沿用 PUT spec、确认、工程生成和构建接口，无独立可执行脚本接口。blocks/entities 新增可选 loot 字段，约束见 MODSPEC.md。非法引用/概率/数量/方块击杀条件返回 422 INVALID_SPEC，字段路径定位至具体掉落条目。完整功能示例含方块晶体掉落、守卫玩家击杀概率掉落与牛皮掉落；目标能力列表增加 custom_loot。


## 服务端验收（0.9）

- `GET /api/projects/:id/game-tests`：当前项目的独立检查记录。
- `POST /api/projects/:id/game-tests`：`{ revision, snapshotHash, allowNetwork, buildId }`，要求当前批准的本机工程与对应成功构建，返回异步检查任务。
- `GET /api/builds/:id/test-report`：成功检查的原始 JSONL；导入备份可下载校验后的外部报告，仍标记未在本机执行。
- 自动创作输入可带 `gameTests: true`。API 默认 false；网页 Java 创作默认勾选，明确包含临时服务器执行授权。

检查先准备依赖，再在 `--network none` 容器运行 Minecraft。`scope: headless-server`，`clientGameTested: false`；不能把 `gameTested: true` 推断为视觉或任意玩法全部验收。环境失败使用 `GAME_ENVIRONMENT`，恢复后重新准备而不消耗模型修复额度。


## 可选 Hub · 0.10

启动 `npm run hub`。`GET /api/platform` 区分 `local` / `hosted`，托管模式给出账号公开字段、线路公开价格和是否配置微信，不含密钥。浏览器写入需要配置的同源 Origin；Cookie 为 HttpOnly，HTTPS 下 Secure。模型专用 Bearer 令牌只能访问模型端点。

- `POST /api/hub/login`：`{ username, password }`；`POST /api/hub/register`：`{ username, password, displayName?, invite? }`。
- `POST /api/hub/logout`：`{}`；`POST /api/hub/password`：`{ oldPassword, newPassword }`，撤销旧会话/令牌。
- `GET /api/hub/account`：账号、最近 100 条账本与投稿；`POST /api/hub/checkin`：`{}`，重复签到幂等。
- `POST /api/hub/invites`：管理员创建一次性七天邀请码；`POST /api/hub/incentives`：`{ title, url }`；`POST /api/hub/incentives/:id/review`：管理员 `{ approve, reward?, reason? }`。
- `GET /api/hub/market?q=&mine=true&favorites=true&pending=true&offset=0`：公开目录或自己的/待审目录；未登录只允许公开，pending 仅管理员。每页最多 50 条。
- `POST /api/hub/market`：`{ id?, revision?, title, description, tags?, license, rightsConfirmed:true, assetIds? | package? }`；上传自己的 1–30 个素材或完整资源包。更新需当前 revision。
- `GET /api/hub/market/:id`：可见修订的元信息；`GET /api/hub/market/:id/package` 下载已校验资源包。
- `POST /api/hub/market/:id/{import,unpublish}`：`{}`；favorite：`{ favorite }`；review：管理员 `{ revision, approve, reason? }`。
- `POST /api/hub/route`：`{ routeId }`，运行中拒绝切换；个人启用的自带配置优先。
- `POST /api/hub/tokens`：`{ label }`，返回一次性展示的 30 天模型令牌；`DELETE /api/hub/tokens`：`{ token }`，仅撤销自己的。
- `POST /api/hub/llm/:routeId/v1/chat/completions`：非流式兼容请求，固定配置的模型/上游，返回 `minemodBilling` 预留/实际扣款/是否用量已知，失败退款。未知用量不是 0 token，仅表示不扣平台积分。
- `GET /api/hub/wechat/start?invite=`：配置后返回官方授权 URL；callback 为服务端换取身份，不在浏览器暴露 AppSecret。真实微信登录未验收。

其他项目/素材/创作/工程/构建接口由认证网关转发到本账号回环内核，继承已有 revision、哈希与执行批准。未登录返回 401，跨账号对象不可读取。部署与协议边界详见 HOSTED.md。


## 层级模型与独立工坊 · 0.12

素材会话、素材保存、bbmodel 导入导出不需要项目 ID。`animated_model.data.bones` 与 `clips[].tracks[].bone` 为可选层级格式，旧模型继续使用 element 轨道；结构、范围和兼容规则见 MODEL-FORMAT.md。bbmodel 导入会识别嵌套分组和无动作骨骼模型，返回 animated_model 及嵌入贴图；静态 Java 素材拒绝 bones，不隐式丢弃。自动 Bedrock 生物请求 animated_model，保留实际动作并绑定选择的片段。
