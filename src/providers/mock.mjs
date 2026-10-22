import example from '../../examples/project-spec.json' with { type: 'json' };

// Offline contract fixture. It must never claim to generate, compile or test a mod.
export const mockProvider = {
  id: 'mock',
  planSpec(project) {
    const spec = structuredClone(example);
    spec.displayName = project.name;
    spec.assumptions.unshift('这是固定的普通物品示例，不代表已理解你的需求；请编辑并确认。');
    return { spec, source: { provider: 'mock', demo: true } };
  },
  plan(project) {
    return {
      provider: 'mock',
      demo: true,
      summary: `待实现的创意：${project.prompt}`,
      assumptions: ['当前输出是固定流程示例，尚未由大模型分析玩法。', '构建目标 Fabric / Minecraft 1.21.1；模板已通过编译，具体作品仍需审查与游戏实测。'],
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
