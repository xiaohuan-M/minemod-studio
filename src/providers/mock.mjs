import example from '../../examples/project-spec.json' with { type: 'json' };

// Offline contract fixture. It must never claim to generate, compile or test a mod.
export const mockProvider = {
  id: 'mock',
  planProposals(project) {
    return {
      proposals: ['轻量入门', '探索收集', '建造装饰'].map((title, index) => ({
        title: '离线固定方案 · ' + title,
        summary: '这是用于比较流程的固定样例，不代表模型理解了需求。',
        gameplay: [
          ['一种材料与一种食物', '收集材料并通过配方制作新物品', '围绕发光方块设计装饰配方'][index],
        ],
        artDirection: ['简洁的双色像素轮廓', '冷色晶体与金色边缘', '低饱和度自然材质'][index],
        acceptance: ['在创造模式检查内容名称', '验证配方与贴图', '在独立测试世界记录实际表现'],
        instruction:
          '目标 ' +
          project.target.loader +
          ' ' +
          project.target.minecraft +
          '。保留现有内容，采用' +
          title +
          '方向；仅使用该目标支持的内容。',
      })),
      source: { provider: 'mock', demo: true },
    };
  },
  planSpec(project) {
    const spec = structuredClone(example);
    spec.displayName = project.name;
    spec.target = structuredClone(project.target);
    spec.assumptions.unshift('这是固定的普通物品示例，不代表已理解你的需求；请编辑并确认。');
    return { spec, source: { provider: 'mock', demo: true } };
  },
  plan(project) {
    return {
      provider: 'mock',
      demo: true,
      summary: `待实现的创意：${project.prompt}`,
      assumptions: [
        '当前输出是固定流程示例，尚未由大模型分析玩法。',
        `目标 ${project.target.loader} / Minecraft ${project.target.minecraft}；具体作品仍需审查与游戏实测。`,
      ],
      steps: [
        { id: 'spec', title: '明确玩法与验收条件', state: 'todo' },
        { id: 'template', title: '初始化经验证的 Fabric 模板', state: 'todo' },
        { id: 'implement', title: '生成代码、资源与配方并审查差异', state: 'todo' },
        { id: 'build', title: '授权后在隔离环境执行真实构建', state: 'todo' },
        { id: 'playtest', title: '进游戏实测行为并记录结果', state: 'todo' },
      ],
    };
  },
};
