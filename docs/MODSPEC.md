# ModSpec v1

规范文件：`schemas/mod-spec.v1.schema.json`；可执行示例：`examples/project-spec.json`。结构检查直接读取该 schema，引用/唯一性等跨字段约束由 `src/core/mod-spec.mjs` 验证。

目标由 src/core/targets.ts 固定组合决定，默认 Fabric 1.21.1 / Java21。四个 Java 目标已真实编译，Bedrock 已验证包结构；详见 TEMPLATE-VALIDATION.md，游戏实测仍需独立完成。

- 一个自定义 modId，2–48 个小写字母、数字或下划线，以字母开头；不能使用 minecraft、fabric、java。
- 1–32 个物品：basic_item、food、sword、pickaxe、axe、shovel、hoe、lightning_wand。提供 zh_cn/en_us 名称，堆叠 1–64；工具与法杖必须为 1。food 必须填写 nutrition/saturation；工具必须填写材质、attackDamage、attackSpeed；法杖可设置 1–120 秒冷却。
- 可选 0–32 个方块，提供名称、硬度、抗爆性和 0–15 亮度；物品与方块 ID 共同唯一。
- 物品和方块可引用资源库中的 textureAsset；物品另可引用 modelAsset（UUID）。资源必须存在且类型正确。textureColor 为没有资源时的程序占位图颜色。
- 0–64 个配方，ID 唯一。有序配方为 1–3 行、每行 1–3 格且同宽；字符与 key 完全对应。无序配方包含 1–9 个原料。
- 引用仅接受已声明的本模组物品/方块和 minecraft 命名空间；原版物品按所选目标的固定注册表校验，旧记录仍可读取以便修正。产物必须是本模组物品/方块，数量不超过其最大堆叠数。
- 0–20 条假设，每条最多 500 字。所有对象拒绝未知字段；不接受脚本、命令、自定义文件路径、行为代码。
- HTTP 请求仍受 24 KiB 总大小限制。超限应拆分规格；条目上限不意味着最大组合都能提交。

流程：创建项目 → 生成离线示例 → 编辑 JSON → 校验并保存 → 检查物品/配方/假设预览 → 确认当前规格 → 导出 JSON。离线示例固定为普通物品，不代表理解了自然语言需求。

保存使用 revision 防止旧页面覆盖新数据；确认绑定规范化 SHA-256。任何重新生成或编辑都清除确认。下载的是已保存版本，未保存的编辑不包含在导出中。JSON 导出不包含密钥，不是 Minecraft 数据包、Fabric 工程或 JAR。

## 历史与恢复

成功替换规格前自动保存旧版本，最多保留 20 个；当前规格另行保留。历史面板可以查看原始 JSON 和当时的确认状态，恢复时先保存当前版本，再恢复选定内容，并清除确认。失败请求不产生历史，过时页面不能恢复覆盖新数据。历史与当前数据在同一个项目记录中原子替换；这不是完整工程快照或断电事务保证。需要长期保留时导出规格或备份整个数据目录。

## 目标与实体扩展

目标组合由 `/api/targets` 注册表确定：Fabric 1.20.1/Java17、Fabric 1.21.1/Java21、Forge 1.20.1/Java17、NeoForge 1.21.1/Java21、Bedrock 1.21.60/java0。Bedrock 的 java=0 表示不适用，支持物品/食物/方块/配方/实体与立方体动画，不支持工具/法杖/Java 物品模型。

Java 目标可配置最多 8 个 `entities`：id、双语 displayName、archetype=zombie|cow、health=1–200、movementSpeed=0.01–1、attackDamage=0–30（cow 必须为 0），可选 textureColor、textureAsset。实体 ID 不重复，其自动生成的 `<id>_spawn_egg` 不能与物品 ID 冲突。实体不自动加入自然生成，未配置 loot 时掉落表为空；其原型的 AI、繁殖、日晒等行为保留。引用贴图必须为 64×64，遵循对应原版模型的归一化 UV。不是自定义骨骼模型协议。

Bedrock 同样接受最多 8 个实体的基础字段，提供简单敌对/被动 AI，不继承完整原版 Java 行为。可选 modelAsset 引用 model/animated_model、animationClip 选择动画片段，贴图允许 16/32/64。默认使用原创立方体角色与 walk 动画；walk 随移动播放，其他选中片段持续播放。模型引用、片段和素材类型在工程生成时校验；Java 不接受这些自定义实体绑定。实体默认不加入自然生成。

## 自定义掉落 · 0.5

blocks/entities 可选 `loot` 数组，每个对象最多 8 条。每条必填 item（原版或已声明本模组物品/方块 ID）、min/max（整数 1–64，min ≤ max）、chance（0–1）；实体可选 playerOnly:boolean。方块不能包含 playerOnly。本模组物品单条 max 不能超过堆叠上限。所有引用按目标版本检查，不支持引用其他模组或未声明刷怪蛋。

每条是独立一次概率判定，可同时掉落；不会自动增加默认条目。省略 loot 保留默认行为：方块掉落自身，实体不掉落；loot=[] 表示明确不掉落。新字段不在读取时自动填充，旧规格哈希保持稳定。Java 使用 block/entity loot table，1.20.1 为 loot_tables、1.21.1 为 loot_table；Bedrock 写入独立 loot_tables 并由 block/entity 组件引用。玩家击杀不包含“玩家或宠物”的扩展条件。

Java 方块保留 survives_explosion，数量使用 set_count/uniform；Bedrock 使用对应的无命名空间函数与条件。时运、抢夺、精准采集、经验、装备继承和自然生成不在本次能力范围。
