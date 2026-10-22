# 开发、验证与发行

Node.js >=24.5，ES modules，npm lockfile 固定版本。`npm ci --ignore-scripts` 后 `npm start`；前端原生模块从固定静态路由提供，无 CDN 或前端构建步骤。`.env` 仅由 CLI 加载，不提交个人配置。模块职责见 ARCHITECTURE.md；工程约定见 AGENTS.md。

## 验证层次

| 命令 | 覆盖 | 外部条件 |
| --- | --- | --- |
| `npm run verify` | 全部 JS 语法、ESLint 未定义变量等规则、TypeScript 契约、Node 单元/API 回归 | 无真实 API/Docker |
| `npm run format:check` | 源码、页面、脚本、测试统一格式 | 无网络 |
| `npm run test:browser` | 方案/会话、UV/姿态、动画编辑/绑定、MCADDON、备份恢复、下载、窄屏 | Chromium；`npx playwright install chromium` 或 `MINEMOD_CHROMIUM_PATH` |
| `npm run test:build` | HTTP → 真 Gradle → JAR/报告/交付包、取消、旧产物保留 | Docker、准备镜像、Maven/Mojang 网络 |
| `npm run package` | 受版本管理源码 + lockfile 生产依赖 + 清单 + SHA-256 | Git、已安装冻结依赖 |
| `npm run test:package` | 实际 ZIP 全文件哈希、外部临时目录解压与启动、静态模块/目标/目录/项目 | 无 npm install/API/Docker |

测试均使用独立临时目录；真实构建证据保留于 `.minemod/validation-*`。`MINEMOD_TEST_TARGET` 可选 fabric-1.21.1（默认）、fabric-1.20.1、forge-1.20.1、neoforge-1.21.1。`MINEMOD_TEST_GRADLE_CACHE` 可把受信任已有缓存复制到独立测试目录。不要用缓存命中来声称首次下载已验证。

`npm run doctor` 仅诊断。`MINEMOD_BUILD_TARGET=forge-1.20.1 npm run setup:builder` 显式准备目标固定镜像；页面也能操作。常规 CI 在三种桌面 OS 运行 verify/format，另在 Ubuntu 跑浏览器与便携包；不自动调用真实模型或下载游戏依赖。远程 CI 状态需独立查看，不能由本地成功推断。

修改生成 Java 或 runner 时必须真实构建相关目标并更新 TEMPLATE-VALIDATION.md，记录模板、游戏/加载器/API/映射/Gradle/JDK/镜像和产物哈希。编译通过仍需独立客户端/服务端游戏测试。

## 发行与升级

1. 同步 package.json、package-lock、界面与能力文档；完成相关检查。
2. 把发行输入纳入 Git 并提交。打包只读取 Git 管理的源文件和 package-lock 的非 dev 依赖，不扫描用户数据。发布包的 manifest 应为 `workingTreeModified:false`。
3. `npm run package` 生成 `dist/minemod-studio-<version>.zip` 和 `.sha256`；`npm run test:package` 验证实际归档。所有运行依赖许可证保留，Node/Docker 不打进包。
4. CI 可上传构建附件；创建 GitHub Release 时另附 ZIP 与校验和，不能把一个成功的本地命令称作已发布 Release。
5. 用户升级先停止服务、备份 `.minemod`，解压到新目录后迁移数据和 `.env`。不要运行两个共享数据目录的进程；私有 .env 永远不进入发行包。

ZIP 时间戳/顺序固定，相同源文件和依赖可重建相同字节。manifest 包含提交和工作区状态；源提交变化会改变包哈希。JAR 不作跨构建字节一致保证。

## 维护边界

数据写入采用乐观版本、单写者锁和原子文件替换；多文件备份导入有预验证/回滚，不承诺断电事务。不要在任务运行时清理目录。没有自动磁盘清理；缓存、工作区和产物需按需备份整理。

新依赖须说明理由与许可，更新 OPEN-SOURCE-REVIEW.md 与 lockfile。源代码/API 变化同步文档和有价值的回归；不要仅测试实现细节。原版游戏数据事实列表固定来源，不分发 Minecraft 游戏代码或纹理。

真实文本/视觉/图像调用按要求跳过；游戏实测、Windows/macOS Docker Desktop、复杂第三方 bbmodel 互通与签名桌面发行仍待验证。错误必须真实呈现，不降级为假成功。
