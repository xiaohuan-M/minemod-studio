# MineMod Studio · 本地模组工坊

**完全开源、本地优先、自带 LLM API 的 Minecraft 创作工具。** 从自然语言与可视化内容编辑，到贴图、立方体模型、源码审查、真实 Gradle 编译和 JAR 交付，代码采用 MIT 许可，无平台账号、积分或订阅依赖。

当前版本 **0.2.0**，已打通 **Java / Fabric / Minecraft 1.21.1** 创作流程。模板和完整内容样例经过真实 Docker 构建；编译成功不代表游戏实测。Forge、NeoForge、Bedrock、其他 Minecraft 版本、任意 Java 行为、实体和动画尚未实现，不能把它称作这些平台的完整支持。

参考 [AutoMods 公开产品流程](https://automods.cn/#faq)，独立实现。不是其源码或官方客户端，与 Mojang、Microsoft 无关联。具体能力和证据见 [功能清单](docs/FEATURES.md) 与 [编译记录](docs/TEMPLATE-VALIDATION.md)。

## 可以做什么

- **需求与持续修改**：自带 Chat Completions API；发送当前规格与修改要求，输出经严格校验；取消、超时、限流提示、连接检查；失败日志可在用户选择后交给模型分析。
- **内容编辑**：普通物品、食物、剑/镐/斧/锹/锄、闪电法杖、方块；中文/英文名称、堆叠、材质、伤害、冷却、硬度、抗爆性、亮度。
- **库存与配方**：内容卡片、3×3 有序/无序合成编辑；本地引用、产物数量和 ID 校验。
- **贴图工坊**：16/32/64 像素绘制、橡皮、填充、撤销、PNG 导入导出；文本 LLM 可生成 16×16 像素数组草稿。
- **模型工坊**：立方体编辑、拖动旋转与缩放预览、多个查看角度；静态 bbmodel 导入导出；文本 LLM 可生成立方体草稿。贴图单独导入绑定；不支持任意网格、骨骼或动画。
- **资源库**：本地保存来源与许可、重复利用、绑定物品/方块；保存修改创建新资源，旧工程继续引用旧资源。
- **版本与工程**：规格导入导出、复制项目、最近 20 个规格版本恢复；确定性工程快照、文件差异、源码预览、完整源码 ZIP（含 Gradle wrapper）。
- **构建与交付**：固定摘要的 Docker 镜像、快照批准、联网选择、真实日志、取消与超时、重启中断记录；校验 JAR 后提供 JAR/源码/报告交付包；失败不覆盖旧成功产物。

未配置 API 时，手动编辑、素材制作、工程生成和构建都可使用；离线示例是固定样例，不会冒充 AI 理解需求。

## 启动

安装 **Node.js 24.5+（推荐 Node 24 LTS）**：

```sh
git clone https://github.com/xiaohuan-M/minemod-studio.git
cd minemod-studio
npm ci
npm start
```

浏览器打开 `http://127.0.0.1:4310`。服务只接受本机 127.0.0.1；没有远程部署/多用户功能。数据默认保存在 `.minemod/`。不要同时运行多个服务进程访问同一数据目录。没有第三方运行依赖，也没有前端打包步骤。

Linux / macOS 可运行 `./start.sh`；Windows 可双击 `start.cmd`。两者均要求先安装 Node；不会静默安装 Docker 或调用模型。

## 配置自己的模型

复制 `.env.example` 为 `.env`，填写并重启：

```dotenv
MINEMOD_LLM_BASE_URL=https://your-provider.example/v1
MINEMOD_LLM_MODEL=your-model
MINEMOD_LLM_API_KEY=your-key
```

本次用户选用的配置是 `https://newapi.nowrise.cn/v1` + `gpt-6-luna`；真实调用按用户要求暂时跳过。程序不写死这家服务；可更换兼容基址和模型。本机模型可使用 `http://127.0.0.1:11434/v1`，本机端点可不设密钥。

在页面选择“我的 LLM API”，核对地址和发送内容，再确认调用。配置本身不会发出请求。密钥只由服务端读取，不进入浏览器、项目或导出。JSON 模式、token 参数和超时配置见 [模型接入](src/providers/README.md)。模型素材是文本生成的结构化像素/立方体草稿，不能等同于专业图像模型或任意 3D 生成服务。

## 制作第一个模组

1. 新建项目，载入完整功能示例或使用自己的模型生成规格。
2. 用内容表单和 3×3 配方编辑器修改；制作或导入贴图/模型，并绑定到内容。
3. 点击“校验并保存修改”，核对后“确认当前规格”。
4. 点击“从已确认规格生成工程”，检查差异和源码。此时可直接下载源码 ZIP。
5. 需要应用内构建时，先安装并启动 **Docker（Linux 容器）**。在页面准备镜像，或显式运行 `npm run setup:builder` 下载固定镜像。
6. 批准此工程快照，首次构建勾选允许下载依赖；点击构建，查看真实日志。
7. 成功后下载 JAR 或交付包；安装匹配的 Fabric Loader 和 Fabric API，在独立游戏实例中实测。

构建容器提供 JDK 21 和 Gradle，无需在宿主安装 JDK。源码包也可用本机 JDK 21 执行 `./gradlew build`（Windows：`gradlew.bat build`）。首次会下载 Minecraft/Maven 依赖。缓存齐全后可尝试禁网构建；不能保证未缓存依赖的离线构建成功。

`npm run doctor` 只检查配置和 Docker，不调用模型、不下载镜像。

## 验证与开发

```sh
npm run verify        # 语法与 Node 自动化测试，不需要 Docker/API
npm run test:build    # 显式真实 Docker 集成构建，会下载依赖，需先准备镜像
```

真实集成检查生成全部支持内容并绑定自定义素材，校验 JAR 内容和 SHA-256、交付 ZIP、取消任务及旧产物保留。保留结果于 `.minemod/validation-*`。常规 CI 不运行这个联网构建。

Linux 的实际构建已验证；Windows/macOS 的应用测试与 Docker Desktop 构建应分别核对，不能由 Linux 结果推断全部平台已通过。游戏实测和真实模型测试尚未完成。

| 文档 | 内容 |
| --- | --- |
| [功能清单](docs/FEATURES.md) | 实现范围、明确限制 |
| [开发说明](docs/DEVELOPMENT.md) | 环境、结构、验证与维护 |
| [接口契约](docs/API.md) | 项目、资源、工程、构建、模型接口 |
| [规格契约](docs/MODSPEC.md) | 数据约束和历史 |
| [构建决策](docs/adr/0002-fixed-container-builder.md) | 隔离、权限、网络和产物验证 |
| [模板编译证据](docs/TEMPLATE-VALIDATION.md) | 固定依赖和真实构建记录 |
| [路线图](docs/ROADMAP.md) | 已实现与待验证工作 |

## 许可证与数据

代码 [MIT](LICENSE)，第三方模板与 Gradle wrapper 保留各自许可证。Minecraft 依赖需要从其合法来源下载，项目许可证不覆盖 Minecraft 代码/资产。素材来源与许可随工程写入 `ASSETS.json`。

备份整个 `.minemod/` 可保留项目、资源、工程和构建记录；`.env` 另行安全保管。没有遥测或自动上传。安全边界见 [SECURITY.md](SECURITY.md)。
