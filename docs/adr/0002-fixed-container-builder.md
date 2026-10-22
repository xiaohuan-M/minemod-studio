# ADR 0002：固定声明式生成器与本机 Docker 构建

状态：已实现，Linux 实际验证，2026-10-22。

模型仅生成 ModSpec 或受限素材数据。服务器从固定模板生成 Java/Gradle 与资源，用户审查确定性快照并批准；API 不接受源码覆盖、命令或 Gradle 参数。修改规格会使批准失效。

构建使用本机 Docker socket/Windows named pipe；忽略远程 DOCKER_HOST/CONTEXT。镜像固定 digest。容器只挂载该次生成目录、共享 Gradle 缓存、固定 runner 脚本和可选公开会话 CA，不挂载 Docker socket、用户目录或 LLM 密钥。只读根、非 root UID、cap-drop ALL、no-new-privileges、2 CPU、4 GiB、256 PID、10 分钟超时。Gradle 只运行固定 build 任务。

默认 `--network none` + `--offline`。用户为本次构建允许联网后，容器可通过配置的代理下载依赖。普通桌面 Docker 默认联网并非目的域名沙箱；应用不声称提供域名级隔离。云环境遵循会话网络策略与 CA 信任，不关闭 TLS 验证。Docker 是本机受信任开发工具的一部分，容器限制不能承诺抵御 Docker/内核漏洞。

构建输出按任务隔离；仅退出码 0、期望 JAR 普通文件、fabric.mod.json ID/MC 版本与入口 class 校验通过才保存产物，下载再次核对大小与 SHA-256。失败不覆盖其他任务。日志上限 256 KiB，记录镜像、runner 哈希与工程哈希。取消移除本任务容器并终止 Docker CLI，超时同样执行。服务重启将未完成记录标记 interrupted，并清理对应容器。

本地单用户单进程。用户拥有本机文件/守护进程权限，本工具不是抵御本机攻击者的安全边界。没有游戏自动安装，也不会接受 EULA、启动客户端或覆盖世界。
