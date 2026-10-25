import { normalizeBones, withSkeleton, removeBone } from '/studio/skeleton.js';
const $ = (id) => document.getElementById(id);
const option = (value, label) => {
  const node = document.createElement('option');
  node.value = String(value);
  node.textContent = label;
  return node;
};

export function initSkeletonEditor({
  getAnimation,
  getBone,
  setAnimation,
  selectBone,
  run,
  feedback,
}) {
  function refresh() {
    const model = getAnimation(),
      index = getBone();
    $('skeleton-fields').hidden = !model?.bones;
    $('skeleton-enable').hidden = !!model?.bones;
    if (!model?.bones) return;
    const bone = model.bones[index];
    if (!bone) return;
    $('skeleton-name').value = bone.name;
    $('skeleton-parent').replaceChildren(
      option('', '独立根骨骼'),
      ...model.bones
        .map((b, i) => option(i, b.name))
        .filter((node) => Number(node.value) !== index),
    );
    $('skeleton-parent').value = bone.parent === undefined ? '' : String(bone.parent);
    $('skeleton-pivot').value = bone.pivot.join(',');
    $('skeleton-bind').value = bone.rotation.join(',');
    $('skeleton-cubes').replaceChildren(
      ...model.elements.map((_, i) =>
        option(i, `立方体 ${i + 1} · ${model.bones.find((b) => b.elements.includes(i)).name}`),
      ),
    );
    $('skeleton-tree').replaceChildren(
      ...model.bones.map((b, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        let depth = 0,
          parent = b.parent;
        while (parent !== undefined) {
          depth++;
          parent = model.bones[parent].parent;
        }
        button.textContent = '· '.repeat(depth) + b.name + ' · ' + b.elements.length + ' 个立方体';
        button.onclick = () => selectBone(i);
        const row = document.createElement('li');
        row.append(button);
        return row;
      }),
    );
  }
  const commit = (model, index) => {
    model.bones = normalizeBones(model.bones, model.elements.length);
    setAnimation(model, index);
  };
  $('skeleton-enable').onclick = run(() => {
    const model = withSkeleton(getAnimation());
    commit(model, 0);
    feedback('已转换为可分组的层级骨骼，原有几何和关键帧已保留。');
  });
  $('skeleton-save').onclick = run(() => {
    const model = structuredClone(getAnimation()),
      index = getBone(),
      bone = model.bones[index];
    const vector = (id) => {
      const parts = $(id).value.split(/[,，]/);
      if (parts.length !== 3 || parts.some((p) => !p.trim()))
        throw new Error('中心和旋转需要三个数值。');
      return parts.map(Number);
    };
    bone.name = $('skeleton-name').value;
    bone.pivot = vector('skeleton-pivot');
    bone.rotation = vector('skeleton-bind');
    if ($('skeleton-parent').value === '') delete bone.parent;
    else bone.parent = Number($('skeleton-parent').value);
    commit(model, index);
    feedback('骨骼层级和绑定姿态已更新。');
  });
  $('skeleton-add').onclick = run(() => {
    const model = structuredClone(getAnimation());
    if (model.bones.length >= 128) throw new Error('骨骼最多 128 个。');
    let n = model.bones.length;
    while (model.bones.some((b) => b.name === 'group_' + n)) n++;
    model.bones.push({ name: 'group_' + n, pivot: [8, 8, 8], rotation: [0, 0, 0], elements: [] });
    commit(model, model.bones.length - 1);
  });
  $('skeleton-move').onclick = run(() => {
    const model = structuredClone(getAnimation()),
      index = getBone(),
      selected = new Set([...$('skeleton-cubes').selectedOptions].map((o) => Number(o.value)));
    if (!selected.size) throw new Error('先选择要移入当前骨骼的立方体。');
    for (const bone of model.bones) bone.elements = bone.elements.filter((i) => !selected.has(i));
    model.bones[index].elements.push(...selected);
    model.bones[index].elements.sort((a, b) => a - b);
    commit(model, index);
  });
  $('skeleton-delete').onclick = run(() => {
    const model = removeBone(getAnimation(), getBone());
    commit(model, 0);
  });
  return { refresh };
}
