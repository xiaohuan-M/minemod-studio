# Fabric 模板真实编译记录

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
