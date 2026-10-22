# MineMod Studio · 本地模组工坊

**完全公开源码、自带 AI 服务、数据保存在自己电脑上的 Minecraft 创作工具。** 用自然语言或表单设计内容，制作贴图与模型，审查源码，编译 Java 模组或打包 Bedrock 附加包。代码采用 MIT 许可，无强制账号、积分、订阅或遥测。

当前版本 **0.3.0**。参考 [AutoMods 公开创作流程](https://automods.cn/#faq)，独立设计和实现；与其、Mojang、Microsoft 均无关联。[优化后的任务书](docs/product/DELIVERY-BRIEF.md) 和 [功能对照](docs/product/PARITY-MATRIX.md) 记录产品目标与实际差距。尚未覆盖参考站宣传的全部游戏版本或任意玩法，不宣称已经全面超越。

## 支持目标

| 目标 | Java 运行版本 | 产物 | 已完成验证 |
| --- | --- | --- | --- |
| Fabric 1.20.1 | 17 | JAR | 完整内容/实体/素材样例真实编译 |
| Fabric 1.21.1 | 21 | JAR | 完整内容/实体/素材样例真实编译 |
| Forge 1.20.1 | 17 | JAR | 完整内容/实体/素材样例真实编译 |
| NeoForge 1.21.1 | 21 | JAR | 完整内容/实体/素材样例真实编译 |
| Bedrock 1.21.60 | 不适用 | MCADDON | 包结构、引用、动画资源与浏览器完整流程 |

以上均**尚未进行游戏实测**。不同目标的能力明确区分，见 [功能清单](docs/FEATURES.md)；编译记录、工具链与产物哈希见 [验证证据](docs/TEMPLATE-VALIDATION.md)。

## 本地启动

需要 **Node.js 24.5+**。选择一种方式：

- **便携 ZIP**：解压 `minemod-studio-0.3.0.zip`，运行 `start.cmd`（Windows）或 `./start.sh`（Linux/macOS）。已附运行依赖和许可证，无需先执行 npm install；Node 和 Docker 未内置。仓库 Actions 成功运行后可下载 `minemod-studio-portable` 构建附件。
- **从源码启动**：

```sh
git clone https://github.com/xiaohuan-M/minemod-studio.git
cd minemod-studio
npm ci --ignore-scripts
npm start
```

在运行程序的电脑打开 `http://127.0.0.1:4310`。这是本机网页应用，固定回环监听，不是公共托管服务。数据位于 `.minemod/`，写锁阻止两个服务同时修改同一目录。`npm run doctor` 检查配置和构建环境，不调用模型或下载镜像。

没有 API 也可以手工编辑、使用原创资源目录、生成工程和交付作品。离线示例明确标为固定示例，不会假装理解自然语言。

## 创作流程

1. 新建项目，选择目标；载入功能示例，或让自己的模型提出方案、生成规格。
2. 编辑物品/食物/工具/方块/生物和九宫格配方；选择原版材料，制作或导入素材。
3. 在模型工坊编辑 UV、贴图、显示姿态；在动画工坊设置关键帧，绑定到 Bedrock 实体。
4. 校验保存并确认规格，生成工程，检查源码和版本差异。此时即可导出完整源码。
5. 批准工程快照后构建。Java 需要启动 Docker（Linux 容器），首次准备固定镜像并允许下载依赖；Bedrock 在本地直接打包。
6. 下载 JAR/MCADDON 或含源码、素材来源和构建报告的交付包，在独立游戏实例验证。

Java 使用锁版本的 Gradle/JDK 容器；也可在源码包中用匹配 JDK 执行 `./gradlew build`。Fabric 1.20.1 容器使用 JDK21 编译器输出 Java17 字节码，Forge 使用 JDK17；其余目标使用 JDK21。源工程首次构建需要下载合法游戏依赖。不会自动安装作品或修改真实游戏目录。

## 自带模型与图片服务

复制 `.env.example` 为 `.env`，填写服务端配置并重启：

```dotenv
MINEMOD_LLM_BASE_URL=https://your-provider.example/v1
MINEMOD_LLM_MODEL=your-model
MINEMOD_LLM_API_KEY=your-key
```

支持 OpenAI-compatible Chat Completions。可以接本机 `http://127.0.0.1:11434/v1`，本机端点允许无密钥；远程服务需 HTTPS 和密钥。文本、图像服务独立配置，`MINEMOD_IMAGE_*` 可接兼容 Images API。参考图生成模型需要文本服务支持视觉输入；图片接口要求返回 base64 PNG。每次调用前可核对目的地与发送内容；密钥不进入浏览器、项目或导出。

当前指定服务 `https://newapi.nowrise.cn/v1`、模型 `gpt-6-luna` 的真实调用按要求跳过。协议、取消、超时和错误处理通过本机模拟服务测试，不能据此保证该服务当前支持所有接口或模型效果。详见 [模型接入](src/providers/README.md)。

## 功能概览

- 多方案比较、持续创作记录、版本恢复、失败构建日志诊断、token 用量记录。
- 物品/方块/生物卡片、九宫格配方、按目标版本校验原版物品 ID。
- 16/32/64 像素绘画、PNG、图片量化、图像生成/参考图编辑、文本或视觉辅助模型草稿。
- 本地 WebGL 贴图预览、UV、手持/头戴/物品栏姿态、截图、静态与受限动画 bbmodel 互通。
- 立方体根骨骼、线性关键帧、播放与片段管理；Bedrock 实体几何/动画/行为打包。
- 本地素材库、来源/许可、可分享资源包、随仓库分发的原创 CC0 目录。
- 项目搜索、重命名、归档、完整备份迁移；不可变素材、规格历史、工程快照、旧成功产物保留。
- 真编译、取消、超时、重启中断恢复、产物检查、完整源码与报告导出。

自定义 Java 动画实体、任意网格/嵌套骨骼、盔甲/维度/GUI、任意代码自动修复、在线多人市场和未列出的 Minecraft 版本尚未实现。

## 开发与维护

```sh
npm run verify        # 语法、ESLint、TypeScript 契约、Node 单元/API 回归
npm run format:check  # 统一代码格式
npx playwright install chromium
npm run test:browser  # 完整网页流程，独立数据目录，无真实 API
npm run package      # 源码 + 生产依赖便携 ZIP + SHA-256
npm run test:package # 解压后独立启动与文件校验
```

`npm run test:build` 显式运行真实 Docker 集成构建；用 `MINEMOD_TEST_TARGET` 选择 Java 目标。常规 CI 不调用真实模型、不下载游戏依赖。Linux 构建已验证，Windows/macOS Docker 与游戏实测仍需独立完成。架构为模块化单体，具体边界见 [架构](docs/ARCHITECTURE.md)、[开发说明](docs/DEVELOPMENT.md)、[贡献指南](CONTRIBUTING.md)。

## 数据与许可

应用代码 [MIT](LICENSE)；便携包保留第三方依赖及其许可证，`RELEASE-MANIFEST.json` 列出源提交、运行依赖与文件哈希。Minecraft、加载器和用户素材保留各自许可，本站 MIT 不为其重新授权。独立原创目录见 [community](community/README.md)。

项目备份包含需求/会话、规格、关联素材、源码快照与产物，最多 32 MiB；分享前自行确认内容。升级前停止服务并备份 `.minemod/`，新目录解压程序后迁移数据和 `.env`，不要覆盖运行中的数据。无数据库级断电事务保证。接口、规格与安全边界见 [API](docs/API.md)、[ModSpec](docs/MODSPEC.md)、[SECURITY](SECURITY.md)。
