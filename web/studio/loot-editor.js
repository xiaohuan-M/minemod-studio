const $ = (id) => document.getElementById(id);
const el = (tag, text) => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
export function initLootEditor({ readSpec, stage, run }) {
  const owner = (spec) => {
    const [group, id] = $('loot-owner').value.split(':');
    const entry = spec[group]?.find((v) => v.id === id);
    if (!['blocks', 'entities'].includes(group) || !entry)
      throw new Error('请先添加并选择方块或实体。');
    return { group, entry };
  };
  const reset = () => {
    $('loot-entry-form').reset();
    delete $('loot-entry-form').dataset.index;
    $('loot-entry-save').textContent = '添加掉落条目';
  };
  function render() {
    let spec;
    try {
      spec = readSpec();
    } catch {
      $('loot-list').replaceChildren();
      return;
    }
    const selected = $('loot-owner').value;
    $('loot-owner').replaceChildren(
      ...['blocks', 'entities'].flatMap((group) =>
        (spec[group] ?? []).map((entry) => {
          const n = el(
            'option',
            (group === 'blocks' ? '方块 · ' : '实体 · ') + entry.displayName.zh_cn,
          );
          n.value = group + ':' + entry.id;
          return n;
        }),
      ),
    );
    if ([...$('loot-owner').options].some((n) => n.value === selected))
      $('loot-owner').value = selected;
    if (!$('loot-owner').value) {
      $('loot-list').replaceChildren();
      $('loot-state').textContent = '添加方块或实体后可编辑掉落。';
      return;
    }
    const { group, entry } = owner(spec);
    $('loot-player-only').disabled = group !== 'entities';
    if (group !== 'entities') $('loot-player-only').checked = false;
    $('loot-state').textContent =
      entry.loot === undefined
        ? group === 'blocks'
          ? '默认掉落自身。添加第一条配置会替换默认掉落。'
          : '默认不掉落物品。'
        : entry.loot.length
          ? '每条独立判定概率，可同时掉落；不会自动增加默认掉落。'
          : '已明确设置为不掉落。';
    $('loot-list').replaceChildren(
      ...(entry.loot ?? []).map((drop, index) => {
        const li = el(
          'li',
          `${drop.item} × ${drop.min}–${drop.max} · ${drop.chance * 100}%${drop.playerOnly ? ' · 玩家击杀' : ''}`,
        );
        const edit = el('button', '编辑掉落');
        edit.type = 'button';
        edit.className = 'secondary';
        edit.onclick = () => {
          reset();
          $('loot-entry-form').dataset.index = String(index);
          $('loot-item').value = drop.item;
          $('loot-min').value = drop.min;
          $('loot-max').value = drop.max;
          $('loot-chance').value = drop.chance * 100;
          $('loot-player-only').checked = !!drop.playerOnly;
          $('loot-entry-save').textContent = '更新掉落条目';
        };
        const remove = el('button', '移除掉落');
        remove.type = 'button';
        remove.className = 'secondary';
        remove.onclick = run(() => {
          const s = readSpec();
          owner(s).entry.loot.splice(index, 1);
          reset();
          stage(s);
        });
        li.append(edit, remove);
        return li;
      }),
    );
  }
  $('loot-entry-form').onsubmit = run(() => {
    const spec = readSpec(),
      { group, entry } = owner(spec);
    const drop = {
      item: $('loot-item').value.trim(),
      min: Number($('loot-min').value),
      max: Number($('loot-max').value),
      chance: Number($('loot-chance').value) / 100,
    };
    if (!drop.item.includes(':')) drop.item = spec.modId + ':' + drop.item;
    if (drop.min > drop.max) throw new Error('最小数量不能大于最大数量。');
    if (group === 'entities' && $('loot-player-only').checked) drop.playerOnly = true;
    entry.loot ??= [];
    const index = $('loot-entry-form').dataset.index;
    if (index !== undefined) {
      if (!entry.loot[Number(index)]) throw new Error('条目已改变，请重新选择编辑。');
      entry.loot[Number(index)] = drop;
    } else {
      if (entry.loot.length >= 8) throw new Error('每个方块或实体最多 8 条掉落。');
      entry.loot.push(drop);
    }
    reset();
    stage(spec);
  });
  $('loot-owner').onchange = () => {
    reset();
    render();
  };
  $('loot-entry-reset').onclick = reset;
  $('loot-default').onclick = run(() => {
    const spec = readSpec();
    delete owner(spec).entry.loot;
    reset();
    stage(spec);
  });
  $('loot-none').onclick = run(() => {
    const spec = readSpec();
    owner(spec).entry.loot = [];
    reset();
    stage(spec);
  });
  $('spec-editor').addEventListener('input', () => {
    reset();
    render();
  });
  document.addEventListener('project-shown', () => {
    reset();
    render();
  });
  render();
}
