# 模板编译与交付验证记录

## 自动创作 · 0.6 · 2026-10-25

`npm run test:creation-build` 实际运行“一句需求 → 规格 → 19 项贴图/模型自动生成绑定 → 工程 → Docker/Gradle → JAR → 完整版本”。模型输出是标注的本机测试服务，不是商业模型效果验证；JAR 来自真实编译。

Fabric 1.21.1 沿用下文固定工具链与受限 runner，复制受信任缓存至独立数据目录。20 次测试模型调用；工程 SHA-256 `e9a42b5712e9fc21ace424e0fb5e9ca381de16427937b90ef825898eeda7d563`；JAR 24,493 字节，SHA-256 `a23a4b11c9f7cc5571a3d0f367ff34a6b9eb86189305de2f7901ab1a1910c7fe`。实际检查主类、实体 PNG、产物哈希及完整版本的工程/产物关联。未运行 Minecraft。

独立 Chromium 检查使用真实本机兼容 HTTP 服务，完成一句话制作、MCADDON 下载、第二轮修改、完整版本恢复、刷新重开及 390px 布局。真实 API 和游戏仍按各自状态单列。

日期：2026-10-22。验证平台：Linux，Docker 28.4.0。以下是编译证据，不代表 Minecraft 客户端游戏实测。

固定版本见 `templates/fabric-1.21.1/manifest.json`：Minecraft 1.21.1、Fabric Loader 0.16.10、Fabric API 0.116.1+1.21.1、Yarn 1.21.1+build.3、Loom 1.8.13、Gradle 8.10.2、JDK 21。

参考模板是 Fabric 官方 fabric-example-mod 的 1.21.1 分支提交 `684b5812a6ce4bb1be750adc36081ac217f9696b`。生成代码独立实现，依赖调整为固定稳定版。保留 CC0 参考许可与 Apache-2.0 Gradle wrapper 许可。Wrapper JAR 与 distribution 的 SHA-256 均对照官方公布值验证。

构建镜像固定摘要：

```
gradle:8.10.2-jdk21@sha256:963d59f7f22767da4efbcf46b661361b61af5fb88b0309da1071c4234c647eba
```

使用只读容器根、非特权用户、移除所有 capabilities、no-new-privileges、4 GiB / 2 CPU / 256 PID 限制，仅挂载独立生成工程、Gradle 缓存、固定 runner 脚本和会话公开 CA。通过会话代理访问 Maven 和 Mojang；没有禁用 TLS 验证。

| 样例 | 真实结果 |
| --- | --- |
| 普通物品与配方基础样例 | Gradle `build` 退出 0；BUILD SUCCESSFUL；7 tasks |
| `examples/full-workshop.json` | Gradle `build` 退出 0；BUILD SUCCESSFUL in 43s；7 tasks |

完整样例覆盖 basic_item、food、sword、pickaxe、axe、shovel、hoe、lightning_wand、发光方块、有序与无序配方，共 45 个生成文件。

完整样例工程 SHA-256：`13fc9fe5796594877ed8ab4e26c502115f501c744776bf631344ad967ac492d5`。

本次完整样例 JAR：17,076 字节，SHA-256 `905cd42de779e14535494f7be5acb4e8270575c1fc6e89368542a17f51ede024`。读取 ZIP 目录与 CRC，检查 `fabric.mod.json`、`GeneratedMod.class` 和 `LightningWand.class` 成功。源码 ZIP 另经 Python zipfile 解压校验全部通过，并验证 gradlew 可执行位。JAR 的 ZIP 时间戳可能随重新构建变化，不能把此 JAR 哈希当作跨构建可重现性承诺。

这些生成项目没有 JUnit 测试，Gradle 的 `test NO-SOURCE` 不表示游戏测试成功。尚未验证客户端启动、配方加载、方块掉落、手持渲染或多人游戏行为。真实 LLM 联调按用户要求跳过；不把模拟 HTTP 测试标为真实服务验证。

## 应用接口端到端验证

2026-10-22，应用真实 API 完成资源入库 → 完整规格 → 确认 → 工程 → 批准 → Docker 构建 → 下载与校验。包含自定义 PNG 和立方体模型绑定。

- 工程 SHA-256：`f833b49b73774b26943d0655d6a577717f4e0644ae66bf747665e60fee50038e`。
- JAR：17,172 字节，SHA-256 `b2e744d44d1dd1faed6c413a2af54da3c4c0a163ca8664b811879b8ee52c7d89`。
- 检查 JAR 内 PNG 与资源接口导出的字节相同；交付 ZIP 内 JAR 与直接下载相同，报告 status=passed。
- 独立无缓存构建也通过：Gradle BUILD SUCCESSFUL in 1m 49s，7 tasks；不是仅依赖已有 Gradle 缓存。
- 分别验证排队取消和运行中容器取消；cancelled 任务不提供产物，之前成功 JAR 仍可下载且哈希不变。

`npm run test:build` 可重跑这一应用级验证。它显式使用 Docker 与网络，不包含在 `npm run verify` 中。真实 LLM 和游戏测试仍未执行。

## Fabric 1.20.1 · 2026-10-22

- Template `fabric-1.20.1-v1`: Minecraft 1.20.1, Yarn 1.20.1+build.10, Loader 0.16.10, Fabric API 0.92.2+1.20.1, Loom 1.8.13, Gradle 8.10.2.
- JDK 21 builder emits Java 17 bytecode (`options.release = 17`); same pinned builder image as 1.21.1.
- Generated `examples/full-workshop.json` with target changed to 1.20.1 / Java 17. Real Docker Gradle `build` succeeded, 7 tasks executed. Food API, tool constructors, Identifier and resource directories adapted separately.
- Snapshot SHA-256: `dff407f7ab92f94a39f402968bef7f0a410dac548f0e2e2add05a88979eae3f2`.
- Verified JAR manifest and main class: 17008 bytes, SHA-256 `7cc90327660d568fb47dbcd08c76fe5055494140c70761356d2dbc50945244ed`.
- This is compilation and artifact evidence; Minecraft client/server gameplay remains untested.

## Bedrock 1.21.60

Independent generator emits behavior/resource packs with stable namespace-derived UUIDs, bilingual text, original procedural or user textures, items, food, solid blocks, loot and recipes. The API integration test packages nested `.mcpack` archives into `.mcaddon`, verifies manifests/dependencies/PNG references and SHA-256, then verifies source delivery. No Docker, Java compiler or game client is involved. Tools, wand scripts and Java item models are explicitly rejected for this target. Package validation is not gameplay validation.

## 实体模板与素材集成 · 2026-10-22

两套目标都使用扩充后的 `examples/full-workshop.json`：原有物品/工具/方块/配方，加晶体守卫（僵尸原型）和苔原牛（牛原型）；还绑定自定义贴图和立方体模型。通过完整 HTTP 生成、批准、Docker 编译、JAR 内容检查、交付包校验、取消与旧产物保留测试。

| 目标 | 工程 SHA-256 | JAR SHA-256 | 大小 |
| --- | --- | --- | --- |
| Fabric 1.21.1 | `138a16707f1434a66f5ccd0e12d92034786bc9d09adf8a5a54ca28b522670af7` | `9f3b3a0fa97ae259e34fab7073031856cce73461c99986a621b023e2d0190623` | 23299 bytes |
| Fabric 1.20.1 | `6b6f27672acc98f1ad896a57b2cb9bdd6c2327767b667820280ff1837fabdc02` | `a030a5dc9e15bb1e98e198841d338a3104b29bac2de824be0466f5cb3409261c` | 23184 bytes |

JAR 包含独立 GeneratedClient 渲染入口、实体贴图和刷怪蛋模型；服务端入口不引用客户端类。1.20.1 使用旧版 setDimensions，1.21.1 使用 dimensions。保留原版实体动画/行为并不代表支持自定义骨骼动画。未启动 Minecraft 游戏客户端验证行为、纹理或多人世界。

## Forge / NeoForge · 2026-10-22

| 目标 | 锁定版本与工具链 | 工程 SHA-256 | JAR SHA-256 |
| --- | --- | --- | --- |
| Forge 1.20.1 | Forge 47.4.28 / ForgeGradle 6.0.42 / Gradle 8.10.2 / JDK 17 | `052718dc025019fb96838a8f05daec4c16c1f9a6cadb27f1b38361b6b3fac179` | `578f7178e1d19addcacf94c8ec7ad4c7f1b989a843fe0802530237699ca77bd3` |
| NeoForge 1.21.1 | NeoForge 21.1.264 / ModDevGradle 2.0.148 / Gradle 8.10.2 / JDK 21 | `80e828d6bcc36596c122d929de60636b834bfcb6785d8eb056113612fd58fa81` | `1b31e1f9313af04b88d7526c001a683f75c7b839f97c0bf83b6fbc8c26133175` |

Forge JAR 25151 bytes；NeoForge JAR 23874 bytes。均真实完成完整内容、素材与实体样例编译、JAR 主类/客户端类/实体纹理/刷怪蛋检查、交付包哈希、取消与旧产物保留。编译不等于游戏实测。

Forge 使用独立官方 Gradle/JDK17 多架构镜像：`gradle:8.10.2-jdk17@sha256:c2900027f3f0681c2cbfb09d527813851ad67aeafbb409997297efa2df20e748`。NeoForge 沿用固定 JDK21 镜像，并显式采用 ModDevGradle 的 `disableRecompilation=true` 官方管线，避免在 4 GiB runner 中反编译整个 Minecraft 源码。该选项仍真实编译生成的模组 Java，不伪造或绕过模组编译。依据 ModDevGradle 文档提交 e9c127db51cd59d8d19e238af6a01e071d769661。

源码使用官方映射的独立注册代码和各加载器元数据；共同 Minecraft JSON/贴图由共享资源生成过程产生，不把 Fabric Java 直接替换包名后交付。

## Bedrock 动画与浏览器验证 · 0.3

新增独立原创实体模型、线性关键帧动画、实体行为与渲染控制器。包检查覆盖 client entity → geometry / animation / texture / render controller 的引用。浏览器实际完成方案与会话、UV/姿态、动画关键帧编辑、绑定实体、生成/批准、MCADDON 下载、完整项目备份恢复和窄屏布局。动画资源另经过独立 Bedrock ZIP 下载、嵌入 PNG 的 bbmodel HTTP 导入往返；不支持的骨骼层级/表达式明确拒绝。

这些是结构与浏览器证据，没有运行 Minecraft Bedrock，也没有使用真实图像或视觉 API。

## 自定义掉落 · 0.5 · 2026-10-25

四个 Java 目标重新执行应用 HTTP → 工程 → Docker/Gradle → JAR → 交付包的完整检查。样例包含方块掉落本模组晶体、数量范围，以及实体概率掉落和玩家击杀条件。测试实际读取 JAR 中对应版本目录的掉落表，检查物品、数量函数和条件；不是只检查生成器字符串。

| 目标 | 工程 SHA-256 | JAR SHA-256 | 大小 |
| --- | --- | --- | --- |
| Fabric 1.21.1 | `fd8c90f320750cec650bf8383c3572001bfc432fe156983a9e43a15903ec29e9` | `7e7f19d64a81a24f94cbbcff16925f0f2f677a96efc055fcd18296caf0afd707` | 23678 bytes |
| Fabric 1.20.1 | `98c3f26a905b7f92b5c71c7c8f8b4142c6b98b1aa27aaecc2a7d71e57799d889` | `86fc696d4bf039f9c97d25327f63f94f379fba3da92b1867481904a3e81461c6` | 23563 bytes |
| Forge 1.20.1 | `e122a9640c7a829da3a0c457a3df40e3051a0c126a2ca1955cfec353cd0134f7` | `87dbb5b99e63b70c7848240c6f1dd4cec4523cffb682a552b71c503a254fd977` | 25530 bytes |
| NeoForge 1.21.1 | `396269416bbd0f41c04055ed803f7cbf4e51e0d49b340f2d7f697cbd8b10178c` | `138b1b67519bf15117507ad5bcb4418691dafaa7fca4c8572fc5cb1a9eec399a` | 24253 bytes |

工具链与镜像沿用上文固定版本；本次使用独立数据目录并复制既有受信任 Gradle 缓存，不作为冷缓存测试。四目标均验证取消后旧成功产物保留。Bedrock 由五目标资源回归检查包中掉落表与组件引用，缺少引用文件必须拒绝打包。

Chromium 实际编辑实体及方块掉落，再修改生命/硬度，确认掉落未丢失；完成 MCADDON 下载和完整项目备份恢复。默认掉落、空掉落与显式配置分别覆盖。Gradle 不验证游戏加载掉落表后的实际行为；所有记录的 `gameTested` 仍为 false。

## 代码级自动修复 · 0.7 · 2026-10-25

四目标均运行真实 Java 编译：本机测试模型先返回含未定义符号的辅助类，实际 Gradle 失败后，再按失败日志返回修正源码并编译成功。不是伪造失败日志或只修规格。每目标 19 项自动素材、22 次测试模型调用、1 轮代码修复；JAR 中检查新增 GeneratedBonus.class。真实模型效果、玩法行为和客户端渲染未验。

| 目标 | 工程 SHA-256 | JAR SHA-256 | 字节 |
| --- | --- | --- | --- |
| fabric-1.21.1 | `bb8d94f481a0a53579e47e36c722756bbd25f408c4b69348b1e01583e269cdba` | `c8b659c98679a52b3f2731ed83822549e8ba6ebbe043030d512b437a3d30d7b3` | 24964 |
| fabric-1.20.1 | `c20cd5746aea64d5f1ed7b932452588ebe63a150eb05ca8d0f113ca3755ab45d` | `e0daa5999c0a6639de1299f0ab02c491cfa06ee77b9240d5f4283977e135c46a` | 24847 |
| forge-1.20.1 | `612f4298c44667baedc68dff566bd9bcdf69408ae0d449f9a4c055effa2630f7` | `0bc37ce185afc04537a21f82111125be372be3470c29f315790c4ebd1f63953f` | 26818 |
| neoforge-1.21.1 | `5c7ac0aa7d8d9ff1f546f97ce73a46f30f9664910b8cb28e8bca698922a3d0db` | `12cd047215cdee7db0976b4d8c01bf5a0a0680826e7cb0ac7046f53958da0ffb` | 25527 |

工具链沿用固定版本，JavaCompile 禁用注解处理器；使用独立测试目录并复制受信任缓存，完成后只移除本轮复制的缓存，保留工程、任务、报告与产物。Fabric 实际获取固定 Yarn Javadoc；Forge/NeoForge 初始网站资料不可达，随后改为官方文档固定 GitHub 提交，并独立验证六个实际文档获取成功，不把原构建中的 unavailable 记录改写为成功。

## 完整贴图模型 · 0.8 · 2026-10-25

五目标资源回归实际比较模型内 PNG 与 Java 物品/Bedrock 实体包资源的字节一致性；实际 HTTP 验证一句模型需求触发几何和贴图两次调用、后续几何修改保留贴图，以及 bbmodel 内 PNG 和重新导入后的完整纹理模型。动画校验仍通过幂等和旧记录回归。

Fabric 1.21.1 自动创作重新真实编译通过，21 次本机测试模型调用、19 项素材。工程 SHA-256 `be4558214ff43658857c89e892bbcdb4a3a5c4b51c11986ae34e34ee3a5d6596`；JAR 24,964 字节，SHA-256 `c8b659c98679a52b3f2731ed83822549e8ba6ebbe043030d512b437a3d30d7b3`。显式内容贴图未改变，所以本次 JAR 与前一轮相同；源工程的内置素材数据和关联不同。不是游戏视觉验证。


## 2026-10-25 · 0.9 真实服务端 GameTest

四目标通过应用的自动创作入口：固定本机模型样例 → 19 个素材 → 受控 Java 扩展 → 实际 Gradle 构建 → 准备运行依赖 → 独立断网临时 Minecraft 服务器 → 完整作品版本。每目标 21 次样例模型调用，0 轮修复；没有商业 API 请求。模型是样例，编译和游戏进程是真实执行。

每目标检查注册/堆叠、资源加载后的配方、实体创建/生命/移动、方块放置与五次掉落的允许引用和数量范围，共四组。未验证掉落概率分布、客户端渲染、任意新玩法、多人和 Bedrock 游戏导入。`scope=headless-server`，`clientVisualTested=false`。

| 目标 | 工程 SHA-256 | JAR SHA-256 / 字节 | 原始检查报告 SHA-256 |
| --- | --- | --- | --- |
| fabric-1.21.1 | `5664a40a5a249fcb08285d60bf39ce4322a85963136e6f215035c1533437a2ec` | `720f7430df66c06fd263cc4128a4af434493198c7e3711bd9d4703ec0ce79b46` / 29508 | `d3849a0a668af1c643d403ef6d82c77c97c82e51e97102eb55a62d25ad4cbb27` |
| fabric-1.20.1 | `31b094fbbdd9ec62ea0f1592ba2730f3ce81fe037c52c199ad69a205ad821246` | `7e0d2b59ab9ce3e09f3faf70397124350da8f81ad1f3453d04d11ef335f6494d` / 29401 | `bb2819299651aa55e0a3b2d59bd755eb5f6d724ed2e9a86b765b5f68f5ac6136` |
| forge-1.20.1 | `29dc4ca8701a7283fffeafd25bb007c73c6f4364ec11a6a153f229691ae06941` | `8c4fb0715e04fa66b2dadeb248ce97b35cac5a0bb00cbb3e90d26f51716307a1` / 31954 | `fa9c3e1191c095aa5d7d562327c93f24a6b085f132eb2f2b8903e87749223009` |
| neoforge-1.21.1 | `d607684b670d3cff0590f5e5834e3807780ed5e05f95f5a349c3cc7a5c97b6a4` | `b23bcf7c3a95e8a6b6e4bb330f9d8ab6430aa6d2995d269c3980181a20958024` / 30580 | `fa9c3e1191c095aa5d7d562327c93f24a6b085f132eb2f2b8903e87749223009` |

本机原始记录目录：`.minemod/creation-validation-LUPHg6`、`.minemod/creation-validation-uQNcZO`、`.minemod/creation-validation-pd5tlO`、`.minemod/creation-validation-7QNOCv`。目录属于独立验证数据，缓存会清理，日志/工程/报告/产物保留；不将游戏依赖或世界文件提交源码仓库。

故障历史：首次 Forge 准备图会连带启动游戏，修复后准备阶段不启动；原默认堆预算造成退出 137，限制 JVM 堆/处理器后通过。NeoForge ModDev 的通用 PrepareRun 隐式下载客户端资产，为 headless 运行单独绑定标明 headless 的属性后，固定服务器库与真正 GameTest 均通过。失败记录未冒充成功。

`npm run verify`：74 项通过；Chromium 两条完整流程通过，格式/语法/ESLint/TypeScript 检查通过。新增检查源保护、缺项/失败收据拒绝、完整版本检查引用和跨目录备份外部证明语义。


## 2026-10-25 · 0.11 自动方块模型与真实服务端检查

四 Java 目标重新执行自动创作，生成并绑定方块静态模型，验证实际 JAR 内模型元素及粒子贴图引用，再启动断网 GameTest。每个目标 20 个素材、22 次明确本机样例调用、0 轮修复、四组服务端检查通过。

| 目标 | 工程 SHA-256 | JAR SHA-256 / 字节 | 报告 SHA-256 |
| --- | --- | --- | --- |
| fabric-1.21.1 | `66a3ca24f64f2ed08a1c24c6e71798d735664d17f5dafc580576e8b562a3e9ca` | `31b12c1a3691150111fecfc68a143fc99e542f87fd4bc2b5d23fc1b74234c80c` / 29994 | `d3849a0a668af1c643d403ef6d82c77c97c82e51e97102eb55a62d25ad4cbb27` |
| fabric-1.20.1 | `adaa7736994fa3de9383af259d95a79b39d58f5cd903215966e31bd78d683fe1` | `88291feee6407e3f0b1ca5ff2e2ddf4fe1a901aaf696eaa88e5fd6a84294bae2` / 29870 | `4a5815b5e13517f6578c3528cbb5bc108a61bf060e9be129bb05731164b5f758` |
| forge-1.20.1 | `1b73365cf50018892265a09578bc03c64a79bc8e923b2c9c301ac36879e8ebd6` | `c985c329ccfab4077e813ee5bf45111a1a5aeb977c09b33945bd9f3e86dff704` / 32212 | `fa9c3e1191c095aa5d7d562327c93f24a6b085f132eb2f2b8903e87749223009` |
| neoforge-1.21.1 | `a50f8fb2412b4cf793ff63cdc9d1406ce5a8b08b534e8bfb4a68e077ead26951` | `cb88a8e16bf762f62fa436ce246cde4ea8d10cc786aa5acd9020dc767d5c89c1` / 30836 | `fa9c3e1191c095aa5d7d562327c93f24a6b085f132eb2f2b8903e87749223009` |

数据：`.minemod/creation-validation-qHlEQ4`、`.minemod/creation-validation-mScvta`、`.minemod/creation-validation-3cAfzy`、`.minemod/creation-validation-z1g3hM`。Java 客户端代码真实编译，但没有客户端视觉验收；服务端检查不检查模型渲染。Bedrock 由五目标模型资源测试及实际浏览器绑定/备份/MCADDON 检查验证，仍未游戏导入。
