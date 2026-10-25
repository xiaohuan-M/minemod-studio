import { sha256 } from '../core/archive.mjs';
const promptField = (kind) => (kind === 'texture' ? 'texturePrompt' : 'modelPrompt');

export function materialSignature(owner, kind) {
  return sha256(
    JSON.stringify({
      kind,
      prompt: owner[promptField(kind)] ?? '',
      type: owner.kind ?? owner.archetype ?? 'block',
      ...(kind === 'texture' ? { color: owner.textureColor ?? null } : {}),
    }),
  );
}

/** Explicit rebindings win unless the request also changes the material brief. */
export function materialNeeded(task, group, owner, before, kind) {
  const field = kind + 'Asset',
    brief = promptField(kind);
  if (!owner[field]) return true;
  const signature = materialSignature(owner, kind);
  if (
    task.assetJobs.some(
      (job) =>
        job.group === group &&
        job.ownerId === owner.id &&
        job.kind === kind &&
        job.assetId === owner[field] &&
        (job.requestHash === signature || (!job.requestHash && !owner[brief])),
    )
  )
    return false;
  if (task.options.refreshMaterials) return true;
  if (owner[brief] && owner[brief] !== before?.[brief]) return true;
  if (!before || owner[field] !== before[field]) return false;
  return (
    (kind === 'texture' && owner.textureColor !== before.textureColor) ||
    owner.kind !== before.kind ||
    owner.archetype !== before.archetype
  );
}

export function materialPrompt(task, project, group, owner, kind) {
  const detail = owner[promptField(kind)] ?? '';
  const subject = `为 ${group}:${owner.id} ${owner.displayName.zh_cn} 制作${kind === 'texture' ? 'Minecraft 像素贴图' : 'Minecraft 立方体模型'}。`;
  const animation =
    kind === 'model' && group === 'entities'
      ? `保留当前骨骼和动作，提供 ${owner.animationClip ?? 'walk'} 片段，使用父子骨骼和多立方体分组。`
      : '';
  return [
    detail.slice(0, 1000),
    task.options.instruction.slice(0, 600),
    subject,
    kind === 'texture' && owner.textureColor ? '目标主色 ' + owner.textureColor : '',
    animation,
    '保持无关部位与素材风格一致。',
    project.prompt.slice(0, 300),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
}
