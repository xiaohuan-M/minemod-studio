# 开源组件与技能评估

2026-10-22。依据公开仓库、npm 元数据和实际源码/许可证。版本以 package-lock.json 和模板 manifest 为准。

| 项目 | 来源 | 决策 |
| --- | --- | --- |
| Three.js | https://github.com/mrdoob/three.js · MIT | 用于真实纹理、相机、射线选择和模型显示；保留许可证 |
| Ajv | https://github.com/ajv-validator/ajv · MIT | 完整标准 schema 验证，保留领域语义检查 |
| pngjs | https://github.com/pngjs/pngjs · MIT | PNG 解码与重采样；先限制尺寸/字节，不自己扩写 PNG 解码器 |
| Playwright | https://github.com/microsoft/playwright · Apache-2.0 | 把浏览器回归加入仓库与 CI，复用现有 Node 技术栈 |
| ESLint / globals | https://github.com/eslint/eslint · MIT / https://github.com/sindresorhus/globals · MIT | 开发期发现未定义变量、漏导入、重复键；浏览器/Node 环境分别声明，不进入发行运行依赖 |
| Prettier / TypeScript | 官方仓库 · MIT / Apache-2.0 | 代码格式与适配器契约，渐进式采用 |
| Blockbench | https://github.com/JannisX11/blockbench · GPL-3.0 | 保留 bbmodel 互通；不直接复制其程序进 MIT 应用，不假装已启动/控制 Blockbench |
| NeoForge MDK | https://github.com/NeoForgeMDKs/MDK-1.21.1-ModDevGradle | 研究官方构建配置，pin 提交 f7002b1b6011723c7b12fde95147689491a6ddab；Maven 网络恢复后已完成真实编译 |
| Mojang bedrock-samples | https://github.com/Mojang/bedrock-samples | 研究包结构、资源与组件；pin 提交 46ba6ea985fb5a92d79a9419198f10dda14c199d；不分发原版素材 |
| Anthropic webapp-testing skill | https://github.com/anthropics/skills/tree/main/skills/webapp-testing | 已审阅：浏览器先观察后操作、保留日志与截图有价值；项目已采用 Node Playwright，不另装 Python 测试工具链或不明技能脚本 |
| MCreator | https://github.com/MCreator/MCreator | 作为可视化创作工具参考；未引入其源码/模板。单个 LICENSE URL 404 不构成许可判断 |

当前可用插件没有 Minecraft 工程或构建的专用能力。图像/3D 插件通常需要单独账号/凭据，不能把其能力冒充为任意文本 API 都能完成；项目优先提供标准、可替换的 provider 接口。没有仅因插件可用就引入它，也没有自动安装或执行 GitHub 上的任意 skill。

开发依赖引入理由：统一格式让生成器/前端可审查；严格契约降低跨加载器适配出错；仓库内浏览器回归可以由贡献者复现。运行依赖均锁定，新增依赖必须在变更说明中说明原因，并核对许可证与供应链信息。

Bedrock 适配以 v1.21.60.10（43ca2795c201b6fff53f38597c4d01f6c4593e1a）为格式参考；其 LICENSE.md 为 Mojang EULA，未复制或再分发其资产或代码。生成器和默认程序贴图独立编写。

pngjs 已用于有尺寸/文件上限的 PNG 解码、CRC 检查、重新编码与本地像素转换；接口不接受远程图片 URL。

- PrismarineJS/minecraft-data 固定提交 1df9432c07c81b47326e4fb1e06d3c8d723bf4aa：依据 dataPaths.json 提取所需版本的事实物品 ID，用于原版配方引用验证；无运行依赖、无图片或游戏代码。上游 README 标注 MIT 并有来源备注，保存在 data/registries/README.md。
- ForgeGradle 6.0.42 / Forge 47.4.28、ModDevGradle 2.0.148 / NeoForge 21.1.264：只在生成工程的构建阶段下载；独立生成注册与元数据代码。原版游戏与加载器的许可仍属于各自项目，非本站 MIT 许可重新授权。
