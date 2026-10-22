# 开发与验证

Node.js >=24.5，ES modules，依赖通过 package-lock.json 固定，选型理由见 docs/research/OPEN-SOURCE-REVIEW.md。`npm ci` 后 `npm start`。前端为原生浏览器模块，不需要构建。`.env` 仅由 CLI 加载，不要提交个人配置。开发约定见 AGENTS.md。

## 代码结构

- `src/core`：ModSpec、素材、ZIP、错误、能力声明；不依赖 HTTP。
- `src/engineering/generator.mjs`：固定 Fabric 工程生成；只接受验证后的声明式规格和素材。
- `templates/fabric-1.21.1`：版本锁、官方 wrapper、校验哈希和许可证。
- `src/storage`：项目历史、不可变素材和工程快照，原子 JSON 替换与完整性检查。
- `src/providers`：Chat Completions 规格/素材适配，大小/超时/取消/脱敏。
- `src/runner/manager.mjs`：真实 Docker 构建、日志、取消、状态恢复、产物校验。
- `src/server.mjs` / `src/workshop-routes.mjs`：Host/Origin 检查与 HTTP 接口。
- `web`：项目、内容、配方、素材、工程与构建界面；`model-preview.js` 为立方体几何预览。

## 检查

`npm run verify` 执行语法检查和 Node 内置自动化测试，使用临时目录与本机模拟模型服务，不需要真实 API 或 Docker。模型模拟测试不能替代实际服务测试。CI 配置在三种桌面平台执行这组检查。

`npm run doctor` 仅读取 Docker 与 provider 配置状态。`npm run setup:builder` 显式授权下载固定镜像。

`npm run test:build` 是独立的联网集成检查：使用专用 `.minemod/validation-*` 数据目录创建完整工程，真实构建并下载验证 JAR 和 bundle，检查取消与旧产物保留。可用 `MINEMOD_TEST_GRADLE_CACHE` 指向已有缓存以复制到独立测试目录，不能把不受信任缓存用于生产。首次无缓存验证也已通过，见模板记录。

构建变更必须记录 Minecraft/Loader/API/Yarn/Loom/Gradle/JDK、模板提交与镜像摘要。新增支持的内容要进入 `examples/full-workshop.json` 并实际编译；扩展其他版本须独立模板与实际验证，不能仅修改能力标记。

## 数据与边界

JSON 存储面向单进程，服务使用带进程身份的排他写锁；不提供数据库级断电事务。同一数据目录的第二个服务会明确拒绝启动；诊断命令不构造会恢复运行任务的 manager。构建镜像准备脚本使用独立临时记录目录。

规格确认、工程审查批准、构建联网选择分别生效。任何规格编辑/恢复使当前工程引用与批准失效，旧快照和产物仍可读取。构建工作区由生成器物化，API 不允许上传任意 Gradle/Java 文件或指定命令。素材保存创建新 ID，原资源不会被覆盖。

工作区、日志和产物会占用磁盘。当前没有自动清理器；不要在构建运行时删除目录。源码和交付 ZIP 不包含 `.env`、密钥或完整项目需求文本。

## 尚需验证

真实 `newapi.nowrise.cn` / `gpt-6-luna` 调用按用户要求跳过。Minecraft 客户端游戏实测、Windows/macOS Docker Desktop 构建、复杂第三方 bbmodel 互通尚未验证。几何预览不是实际持有姿态渲染器，导入不支持的模型类型会报错。

浏览器验证：`npx playwright install chromium` 后执行 `npm run test:browser`。也可用 `MINEMOD_CHROMIUM_PATH` 指定已安装 Chromium。脚本创建独立数据目录，不调用真实 API，覆盖目标选择、规格编辑、WebGL、UV/姿态保存、截图下载与窄屏布局。Three.js 与 OrbitControls 从锁定的本地 node_modules 映射到固定 URL，不使用 CDN 或宽泛静态目录。

备份导入先在数据目录下的临时目录验证，再移动新记录并最后提交项目；异常会回滚本次新增文件。进程在提交过程中被强制终止可能留下无项目引用的文件，未提供完整的断电事务保证。
