import { TARGET } from './project.mjs';

export function capabilities() {
  return {
    stage: 'M0',
    target: { ...TARGET },
    provider: { id: 'mock', externalRequests: false, label: '离线演示规划器' },
    features: {
      projectStorage: true,
      demoPlanning: true,
      llmPlanning: false,
      codeGeneration: false,
      textureGeneration: false,
      blockbench: false,
      gradleBuild: false,
      jarExport: false,
    },
  };
}
