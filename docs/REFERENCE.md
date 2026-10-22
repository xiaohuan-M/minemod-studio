# 参考调研与范围判断

查阅日期：2026-10-22。仅使用公开页面；未登录、未检验对方生成的模组，也未取得其源代码或内部设计。

## 产品参照

[AutoMods 公开页面](https://automods.cn/#faq) 展示的主线是自然语言创作、制作计划、代码与资源生成、真实编译和下载；还有资源预览、历史版本、贴图及建模功能。页面的能力与兼容版本属于对方的产品说明，不等于本项目已验证的能力。

本项目借鉴“可见的步骤”和“最终交付工程”，自行设计本地数据、模型适配与构建边界。先做一个版本的端到端闭环，之后再考虑资源编辑与更多加载器。账号、积分、市场和创作激励不属于本地版首要需求。

## 技术依据

- [Fabric 1.21.1 Java 安装说明](https://github.com/FabricMC/fabric-docs/blob/main/versions/1.21.1/players/installing-java/windows.md)：作为 JDK 21 的依据；模组构建需要 JDK 而非仅 JRE。
- [Fabric 官方开发文档](https://docs.fabricmc.net/develop/getting-started/setting-up)：开发环境入口；进入后应选择目标版本，不使用当前最新页面内容直接生成旧版本 API。
- [Fabric 官方示例工程](https://github.com/FabricMC/fabric-example-mod)：后续模板选型入口。M2 必须选择明确分支与提交、核验许可证和 Gradle wrapper，不能直接跟随默认分支。
- [Blockbench 官方项目](https://github.com/JannisX11/blockbench)：后续模型文件与插件协议研究入口；M0 未实现集成。
- [Node.js 官方文档](https://nodejs.org/api/)：本地 HTTP、文件系统和内置测试基础。

## 尚待验证

模板的确切 Loader、Fabric API、映射、Loom 与 Gradle 版本；各模型的规格输出质量；本地 runner 的跨平台隔离方案；导出 JAR 的真实游戏行为。以上不得在验证前写进“已支持”列表。
