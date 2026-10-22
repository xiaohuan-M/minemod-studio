import { TARGET } from './project.mjs';

export function capabilities() {
  return {
    stage: 'multi-target-workshop-preview',
    target: { ...TARGET },
    provider: { id: 'mock', externalRequests: false, label: '离线演示规划器' },
    features: {
      projectStorage: true,
      demoPlanning: true,
      modSpec: true,
      specReview: true,
      specExport: true,
      specHistory: true,
      llmPlanning: true,
      codeGeneration: true,
      textureGeneration: true,
      textureEditor: true,
      textureAI: true,
      cubeModelAI: true,
      cubeModelEditor: true,
      blockbench: true,
      gradleBuild: true,
      jarExport: true,
      sourceExport: true,
      snapshotReview: true,
      buildCancellation: true,
      buildRepairPlanning: true,
      gamePlaytested: false,
      forge: false,
      neoForge: false,
      bedrock: true,
    },
  };
}
