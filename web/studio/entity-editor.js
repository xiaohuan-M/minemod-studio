const $ = (id) => document.getElementById(id);
const el = (tag, text) => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};
export function initEntityEditor({ readSpec, stage, run, getProject }) {
  let editing = null;
  const fields = {
    id: 'entity-id',
    zh: 'entity-zh',
    en: 'entity-en',
    archetype: 'entity-archetype',
    health: 'entity-health',
    movementSpeed: 'entity-speed',
    attackDamage: 'entity-damage',
    textureAsset: 'entity-texture',
    textureColor: 'entity-color',
  };
  const reset = () => {
    editing = null;
    $('entity-form').reset();
  };
  function render() {
    const bedrock = getProject()?.target.edition === 'bedrock';
    $('entity-form').hidden = bedrock;
    $('entity-limit').textContent = bedrock
      ? '当前 Bedrock 适配器不提供实体；切换到 Fabric 项目可编辑。'
      : '僵尸/牛保留原版行为和动画，不自动加入自然生成。用创造模式刷怪蛋验证。64×64 贴图需匹配所选原版模型 UV；牛的原始 64×32 布局请纵向放大两倍。';
    let spec;
    try {
      spec = readSpec();
    } catch {
      $('entity-list').replaceChildren();
      return;
    }
    $('entity-list').replaceChildren(
      ...(spec.entities ?? []).map((entity, index) => {
        const card = el('article', '');
        card.className = 'card';
        card.append(
          el('strong', entity.displayName.zh_cn),
          el(
            'small',
            entity.id +
              ' · ' +
              entity.archetype +
              ' · 生命 ' +
              entity.health +
              ' · 速度 ' +
              entity.movementSpeed,
          ),
        );
        const edit = el('button', '编辑实体');
        edit.className = 'secondary';
        edit.onclick = () => {
          editing = index;
          for (const [field, id] of Object.entries(fields))
            $(id).value =
              field === 'zh'
                ? entity.displayName.zh_cn
                : field === 'en'
                  ? entity.displayName.en_us
                  : (entity[field] ?? (field === 'textureColor' ? '#8e62cf' : ''));
        };
        const remove = el('button', '移除实体');
        remove.className = 'secondary';
        remove.onclick = run(() => {
          const current = readSpec();
          current.entities.splice(index, 1);
          stage(current);
          reset();
        });
        card.append(edit, remove);
        return card;
      }),
    );
  }
  $('entity-form').onsubmit = run(() => {
    const spec = readSpec(),
      entity = {
        id: $('entity-id').value.trim(),
        displayName: { zh_cn: $('entity-zh').value.trim(), en_us: $('entity-en').value.trim() },
        archetype: $('entity-archetype').value,
        health: Number($('entity-health').value),
        movementSpeed: Number($('entity-speed').value),
        attackDamage: $('entity-archetype').value === 'cow' ? 0 : Number($('entity-damage').value),
        textureColor: $('entity-color').value,
      };
    if ($('entity-texture').value) entity.textureAsset = $('entity-texture').value;
    spec.entities ??= [];
    if (editing === null) {
      if (spec.entities.length >= 8) throw new Error('每个规格最多 8 种实体。');
      spec.entities.push(entity);
    } else spec.entities[editing] = entity;
    stage(spec);
    reset();
  });
  $('entity-reset').onclick = reset;
  $('entity-archetype').onchange = () => {
    if ($('entity-archetype').value === 'cow') $('entity-damage').value = '0';
  };
  $('spec-editor').addEventListener('input', render);
  document.addEventListener('project-shown', () => {
    reset();
    render();
  });
  document.addEventListener('assets-loaded', ({ detail }) => {
    const selected = $('entity-texture').value;
    $('entity-texture').replaceChildren(
      ...[
        { id: '', name: '程序占位贴图' },
        ...detail.filter((a) => a.kind === 'texture' && a.width === 64),
      ].map((a) => {
        const o = el('option', a.name);
        o.value = a.id;
        return o;
      }),
    );
    $('entity-texture').value = selected;
  });
  return { render };
}
