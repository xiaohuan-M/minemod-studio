import { initAnimationEditor } from './studio/animation-editor.js';
import { initEntityEditor } from './studio/entity-editor.js';
import { initLootEditor } from './studio/loot-editor.js';
import { initImageStudio } from './studio/image-studio.js';
import { initModelEditor } from './studio/model-editor.js';
const $ = (id) => document.getElementById(id);
const tools = new Set(['sword', 'pickaxe', 'axe', 'shovel', 'hoe']);
const names = {
  basic_item: '物品',
  food: '食物',
  sword: '剑',
  pickaxe: '镐',
  axe: '斧',
  shovel: '锹',
  hoe: '锄',
  lightning_wand: '闪电法杖',
  block: '方块',
};
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const option = (value, text) => {
  const node = el('option', text);
  node.value = value;
  return node;
};
const download = (path, text) => {
  const node = el('a', text);
  node.href = path;
  node.download = '';
  return node;
};
export function initWorkshop({
  api,
  getProvider,
  getProject,
  isDirty,
  isBusy,
  show,
  refresh,
  feedback,
}) {
  let vanillaIds = [];
  let editing = null,
    assets = [],
    snapshot = null,
    requestEpoch = 0,
    fileEpoch = 0,
    activeBuild = null,
    pollTimer = null,
    formBusy = false;
  const request = (path, method = 'POST', data = {}) =>
    api(path, { method, body: JSON.stringify(data) });
  const projectRoot = () => '/api/projects/' + getProject().id;
  const run = (fn) => async (event) => {
    event?.preventDefault();
    if (formBusy || isBusy()) return;
    formBusy = true;
    try {
      await fn(event);
    } catch (error) {
      feedback(error.message, true);
    } finally {
      formBusy = false;
      controls();
    }
  };
  const readSpec = () => {
    const value = JSON.parse($('spec-editor').value || 'null');
    if (!value) throw new Error('请先生成离线示例、使用模型生成规格，或载入完整功能示例。');
    return value;
  };
  function stage(spec) {
    $('spec-editor').value = JSON.stringify(spec, null, 2);
    $('spec-panel').hidden = false;
    $('spec-editor').dispatchEvent(new Event('input'));
    renderContent();
    controls();
    feedback('修改已写入规格草稿。请点击“校验并保存修改”，然后确认规格。');
  }
  function controls() {
    const p = getProject();
    $('generate-workspace').disabled = formBusy || isBusy() || isDirty() || !p?.confirmedSpecHash;
    $('approve-workspace').disabled =
      formBusy ||
      isDirty() ||
      !snapshot ||
      snapshot.hash !== p?.workspaceHash ||
      p?.approvedWorkspaceHash === snapshot.hash;
    $('start-build').disabled =
      formBusy ||
      isDirty() ||
      !snapshot ||
      snapshot.hash !== p?.approvedWorkspaceHash ||
      snapshot.hash !== p?.workspaceHash ||
      !!activeBuild;
    $('engineering-state').textContent = p?.workspaceHash
      ? '当前工程 ' +
        p.workspaceHash.slice(0, 12) +
        ' · ' +
        (p.approvedWorkspaceHash === p.workspaceHash ? '已批准' : '待审查')
      : '先保存并确认规格，再生成工程。';
  }
  function kindFields() {
    const kind = $('content-kind').value;
    for (const [id, visible] of [
      ['food-fields', kind === 'food'],
      ['tool-fields', tools.has(kind)],
      ['wand-fields', kind === 'lightning_wand'],
      ['block-fields', kind === 'block'],
    ])
      $(id).hidden = !visible;
    const single = tools.has(kind) || kind === 'lightning_wand';
    $('content-stack').disabled = single || kind === 'block';
    if (single) $('content-stack').value = '1';
    else if ($('content-stack').value === '1') $('content-stack').value = '64';
    $('content-model').disabled = kind === 'block';
  }
  function resetContent() {
    editing = null;
    $('content-form').reset();
    $('content-delete').hidden = true;
    $('content-save').textContent = '添加到规格草稿';
    kindFields();
  }
  function editContent(item, kind, index) {
    editing = { kind, index };
    $('content-kind').value = kind;
    kindFields();
    for (const [id, value] of [
      ['content-id', item.id],
      ['content-zh', item.displayName.zh_cn],
      ['content-en', item.displayName.en_us],
      ['content-stack', item.maxStackSize ?? 64],
      ['content-color', item.textureColor ?? '#8e62cf'],
      ['content-texture', item.textureAsset ?? ''],
      ['content-model', item.modelAsset ?? ''],
      ['food-nutrition', item.food?.nutrition ?? 5],
      ['food-saturation', item.food?.saturation ?? 0.6],
      ['tool-material', item.tool?.material ?? 'diamond'],
      ['tool-damage', item.tool?.attackDamage ?? 3],
      ['tool-speed', item.tool?.attackSpeed ?? -2.4],
      ['wand-cooldown', item.cooldownSeconds ?? 3],
      ['block-hardness', item.hardness ?? 2],
      ['block-resistance', item.resistance ?? 6],
      ['block-light', item.luminance ?? 0],
    ])
      $(id).value = value;
    $('content-delete').hidden = false;
    $('content-save').textContent = '更新规格草稿中的条目';
    $('content-form').closest('details').open = true;
  }
  const recipeCells = Array.from({ length: 9 }, (_, i) => {
    const input = el('input');
    input.setAttribute('aria-label', '原料格 ' + (i + 1));
    input.setAttribute('list', 'ingredients');
    input.maxLength = 115;
    input.placeholder = String(i + 1);
    $('recipe-grid').append(input);
    return input;
  });
  function renderContent() {
    try {
      let spec;
      try {
        spec = readSpec();
      } catch {
        $('inventory').replaceChildren();
        $('recipe-list').replaceChildren();
        return;
      }
      const entries = [
        ...spec.items.map((item, index) => ({ item, index, kind: item.kind })),
        ...(spec.blocks ?? []).map((item, index) => ({ item, index, kind: 'block' })),
      ];
      $('inventory').replaceChildren(
        ...entries.map(({ item, index, kind }) => {
          const card = el('button', undefined, 'card');
          card.type = 'button';
          if (item.textureAsset) {
            const img = el('img');
            img.src = '/api/assets/' + item.textureAsset + '/png';
            img.alt = '';
            card.append(img);
          }
          card.append(
            el('strong', item.displayName.zh_cn),
            el('small', names[kind] + ' · ' + item.id),
          );
          card.addEventListener('click', () => editContent(item, kind, index));
          return card;
        }),
      );
      const previous = $('recipe-result').value;
      $('recipe-result').replaceChildren(
        ...entries.map(({ item }) =>
          option(spec.modId + ':' + item.id, item.displayName.zh_cn + ' · ' + item.id),
        ),
      );
      if ([...$('recipe-result').options].some((o) => o.value === previous))
        $('recipe-result').value = previous;
      $('ingredients').replaceChildren(
        ...[...entries.map(({ item }) => spec.modId + ':' + item.id), ...vanillaIds].map((v) =>
          option(v, v),
        ),
      );
      $('recipe-list').replaceChildren(
        ...spec.recipes.map((recipe, index) => {
          const card = el('article');
          card.append(
            el('strong', recipe.id + ' → ' + recipe.result.item + ' × ' + recipe.result.count),
          );
          const cells =
            recipe.type === 'crafting_shaped'
              ? Array.from(
                  { length: 9 },
                  (_, i) => recipe.key[recipe.pattern[Math.floor(i / 3)]?.[i % 3]] ?? '',
                )
              : Array.from({ length: 9 }, (_, i) => recipe.ingredients[i] ?? '');
          const grid = el('div', undefined, 'mini-grid');
          grid.append(...cells.map((value) => el('span', value || '·')));
          const edit = el('button', '编辑', 'secondary'),
            remove = el('button', '移除', 'secondary');
          edit.onclick = () => {
            $('recipe-id').value = recipe.id;
            $('recipe-type').value = recipe.type;
            $('recipe-result').value = recipe.result.item;
            $('recipe-count').value = recipe.result.count;
            cells.forEach((v, i) => (recipeCells[i].value = v));
          };
          remove.onclick = run(() => {
            const next = readSpec();
            next.recipes.splice(index, 1);
            stage(next);
          });
          card.append(grid, edit, remove);
          return card;
        }),
      );
    } catch {
      $('inventory').replaceChildren(el('p', '草稿结构不完整；请校验规格后使用可视化编辑器。'));
      $('recipe-list').replaceChildren();
    }
  }
  $('content-kind').addEventListener('change', kindFields);
  $('content-reset').onclick = resetContent;
  $('content-form').addEventListener(
    'submit',
    run(() => {
      const spec = readSpec(),
        kind = $('content-kind').value;
      const item = {
        id: $('content-id').value.trim(),
        displayName: { zh_cn: $('content-zh').value.trim(), en_us: $('content-en').value.trim() },
        textureColor: $('content-color').value,
      };
      if ($('content-texture').value) item.textureAsset = $('content-texture').value;
      if (kind === 'block')
        Object.assign(item, {
          hardness: Number($('block-hardness').value),
          resistance: Number($('block-resistance').value),
          luminance: Number($('block-light').value),
        });
      else {
        Object.assign(item, { kind, maxStackSize: Number($('content-stack').value) });
        if ($('content-model').value) item.modelAsset = $('content-model').value;
        if (kind === 'food')
          item.food = {
            nutrition: Number($('food-nutrition').value),
            saturation: Number($('food-saturation').value),
          };
        if (tools.has(kind))
          item.tool = {
            material: $('tool-material').value,
            attackDamage: Number($('tool-damage').value),
            attackSpeed: Number($('tool-speed').value),
          };
        if (kind === 'lightning_wand') item.cooldownSeconds = Number($('wand-cooldown').value);
      }
      const target = kind === 'block' ? (spec.blocks ??= []) : spec.items;
      if (editing) {
        const source = editing.kind === 'block' ? spec.blocks : spec.items;
        if (
          kind === 'block' &&
          editing.kind === 'block' &&
          source[editing.index].loot !== undefined
        )
          item.loot = source[editing.index].loot;
        if (source === target) source[editing.index] = item;
        else {
          source.splice(editing.index, 1);
          target.push(item);
        }
      } else target.push(item);
      stage(spec);
      resetContent();
    }),
  );
  $('content-delete').onclick = run(() => {
    if (!editing) return;
    const spec = readSpec();
    (editing.kind === 'block' ? spec.blocks : spec.items).splice(editing.index, 1);
    stage(spec);
    resetContent();
  });
  $('recipe-reset').onclick = () => {
    $('recipe-form').reset();
    recipeCells.forEach((c) => (c.value = ''));
  };
  $('recipe-form').addEventListener(
    'submit',
    run(() => {
      const spec = readSpec(),
        type = $('recipe-type').value;
      const cells = recipeCells.map((cell) => {
        const v = cell.value.trim();
        return v && !v.includes(':') ? spec.modId + ':' + v : v;
      });
      if (!cells.some(Boolean)) throw new Error('至少放入一个原料。');
      const recipe = {
        id: $('recipe-id').value.trim(),
        type,
        result: { item: $('recipe-result').value, count: Number($('recipe-count').value) },
      };
      if (type === 'crafting_shapeless') recipe.ingredients = cells.filter(Boolean);
      else {
        const map = new Map();
        const pattern = Array.from({ length: 3 }, (_, row) =>
          cells
            .slice(row * 3, row * 3 + 3)
            .map((value) => {
              if (!value) return ' ';
              if (!map.has(value)) map.set(value, String.fromCharCode(65 + map.size));
              return map.get(value);
            })
            .join(''),
        );
        while (pattern.at(-1) === '   ') pattern.pop();
        while (pattern[0] === '   ') pattern.shift();
        let start = 0,
          end = 3;
        while (pattern.every((row) => row[start] === ' ')) start++;
        while (pattern.every((row) => row[end - 1] === ' ')) end--;
        recipe.pattern = pattern.map((row) => row.slice(start, end));
        recipe.key = Object.fromEntries([...map].map(([item, key]) => [key, item]));
      }
      const at = spec.recipes.findIndex((r) => r.id === recipe.id);
      if (at < 0) spec.recipes.push(recipe);
      else spec.recipes[at] = recipe;
      stage(spec);
    }),
  );
  $('load-full-example').onclick = run(async () => {
    if (isDirty() && !window.confirm('载入示例会替换未保存的规格草稿。继续吗？')) return;
    const t = getProject().target;
    stage(await api('/api/examples/full-workshop?target=' + t.loader + '-' + t.minecraft));
    resetContent();
  });
  $('clone-project').onclick = run(async () => {
    if (isDirty()) throw new Error('请先保存规格修改，再复制项目。');
    show(await request(projectRoot() + '/clone'));
    await refresh();
    feedback('已复制规格为新项目；需要重新确认与构建。');
  });
  $('import-spec').onchange = run(async () => {
    const file = $('import-spec').files[0];
    if (!file) return;
    if (file.size > 20 * 1024) throw new Error('规格文件最多 20 KiB。');
    if (isDirty() && !window.confirm('导入会替换未保存的规格草稿。继续吗？')) return;
    stage(JSON.parse(await file.text()));
    resetContent();
  });
  $('spec-editor').addEventListener('input', () => {
    renderContent();
    controls();
  });
  // Pixel editor: imports are decoded locally after PNG dimension checks.
  let size = 16,
    pixels = Array(256).fill('#00000000'),
    undo = [],
    painting = false;
  const pixelCanvas = $('pixel-canvas'),
    ctx = pixelCanvas.getContext('2d');
  const backup = () => {
    undo.push([...pixels]);
    if (undo.length > 30) undo.shift();
  };
  function drawPixels() {
    const step = 256 / size;
    ctx.clearRect(0, 0, 256, 256);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#e1e7db' : '#f8faf4';
        ctx.fillRect(x * step, y * step, step, step);
        ctx.fillStyle = pixels[y * size + x];
        ctx.fillRect(x * step, y * step, step, step);
      }
  }
  function paint(event) {
    const r = pixelCanvas.getBoundingClientRect(),
      x = Math.floor(((event.clientX - r.left) / r.width) * size),
      y = Math.floor(((event.clientY - r.top) / r.height) * size);
    if (x >= 0 && y >= 0 && x < size && y < size)
      pixels[y * size + x] = $('pixel-erase').checked ? '#00000000' : $('pixel-color').value + 'ff';
    drawPixels();
  }
  pixelCanvas.onpointerdown = (event) => {
    backup();
    painting = true;
    pixelCanvas.setPointerCapture(event.pointerId);
    paint(event);
  };
  pixelCanvas.onpointermove = (event) => {
    if (painting) paint(event);
  };
  pixelCanvas.onpointerup = pixelCanvas.onpointercancel = () => (painting = false);
  $('texture-size').onchange = () => {
    size = Number($('texture-size').value);
    pixels = Array(size * size).fill('#00000000');
    undo = [];
    drawPixels();
  };
  $('pixel-fill').onclick = () => {
    backup();
    pixels.fill($('pixel-color').value + 'ff');
    drawPixels();
  };
  $('pixel-clear').onclick = () => {
    backup();
    pixels.fill('#00000000');
    drawPixels();
  };
  $('pixel-undo').onclick = () => {
    if (undo.length) pixels = undo.pop();
    drawPixels();
  };
  $('texture-import').onchange = run(async () => {
    const file = $('texture-import').files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) throw new Error('PNG 最多 1 MiB。');
    const buffer = await file.arrayBuffer(),
      view = new DataView(buffer);
    if (
      buffer.byteLength < 33 ||
      view.getUint32(0) !== 0x89504e47 ||
      view.getUint32(4) !== 0x0d0a1a0a
    )
      throw new Error('请选择 PNG 文件。');
    const width = view.getUint32(16),
      height = view.getUint32(20);
    if (![16, 32, 64].includes(width) || height !== width)
      throw new Error('PNG 尺寸需要为 16、32 或 64 像素正方形。');
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext('2d');
    c.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = c.getImageData(0, 0, width, height).data;
    size = width;
    pixels = Array.from(
      { length: width * height },
      (_, i) =>
        '#' +
        Array.from(data.slice(i * 4, i * 4 + 4))
          .map((v) => v.toString(16).padStart(2, '0'))
          .join(''),
    );
    $('texture-size').value = String(size);
    undo = [];
    drawPixels();
    feedback('PNG 已载入本地编辑器。请核对来源和许可后保存。');
  });
  const assetPayload = (kind, name, data) => ({
    kind,
    name,
    data,
    source: $('asset-source').value,
    license: $('asset-license').value,
  });
  $('texture-save').onclick = run(async () => {
    await request(
      '/api/assets',
      'POST',
      assetPayload('texture', $('texture-name').value, { width: size, height: size, pixels }),
    );
    await refreshAssets();
    feedback('贴图已保存。可以在内容编辑器绑定到物品或方块。');
  });
  const modelEditor = initModelEditor({
    api,
    request,
    run,
    assetPayload,
    refreshAssets,
    feedback,
    getPixels: () => ({ width: size, height: size, pixels }),
  });
  const animationEditor = initAnimationEditor({
    request,
    run,
    assetPayload,
    refreshAssets,
    feedback,
    getModel: () => modelEditor.get(),
    getPixels: () => ({ width: size, height: size, pixels }),
  });
  initImageStudio({ api, request, run, assetPayload, refreshAssets, feedback });
  let assetAbort = null;
  $('ai-asset-cancel').onclick = () => assetAbort?.abort();
  $('ai-asset-generate').onclick = run(async () => {
    const provider = getProvider();
    if ($('provider-select').value !== 'openai-compatible' || !provider?.configured)
      throw new Error('请先配置并选择“我的 LLM API”，核对服务商与模型。');
    if (!$('ai-asset-consent').checked) throw new Error('请确认本次素材调用。');
    assetAbort = new AbortController();
    $('ai-asset-cancel').hidden = false;
    feedback('正在请求模型生成结构化素材……');
    try {
      const result = await api('/api/providers/openai-compatible/asset', {
        method: 'POST',
        body: JSON.stringify({
          consent: provider.configurationId,
          kind: $('ai-asset-kind').value,
          prompt: $('ai-asset-prompt').value,
          referenceId: $('ai-asset-reference').value || undefined,
        }),
        signal: assetAbort.signal,
      });
      if (result.kind === 'texture') {
        size = result.data.width;
        pixels = [...result.data.pixels];
        undo = [];
        $('texture-size').value = String(size);
        $('texture-name').value = '模型生成的贴图';
        drawPixels();
      } else {
        modelEditor.set(result.data);
        $('model-name').value = '模型生成的立方体';
      }
      $('asset-source').value = 'LLM: ' + result.source.model;
      $('asset-license').value = '待用户核对服务商条款';
      feedback('模型素材已通过结构校验并载入编辑器。请审查和修改，填写许可说明后保存到资源库。');
    } finally {
      assetAbort = null;
      $('ai-asset-cancel').hidden = true;
      $('ai-asset-consent').checked = false;
    }
  });
  async function refreshAssets() {
    assets = (await api('/api/assets')).assets;
    document.dispatchEvent(new CustomEvent('assets-loaded', { detail: assets }));
    for (const [id, kind, label] of [
      ['content-texture', 'texture', '使用占位贴图'],
      ['content-model', 'model', '使用默认模型'],
      ['ai-asset-reference', 'image', '不发送参考图'],
    ]) {
      const selected = $(id).value;
      $(id).replaceChildren(
        option('', label),
        ...assets.filter((a) => a.kind === kind).map((a) => option(a.id, a.name)),
      );
      $(id).value = selected;
    }
    $('asset-library').replaceChildren(
      ...assets
        .filter(
          (asset) =>
            asset.kind !== 'image' &&
            [asset.name, asset.source, asset.license]
              .join(' ')
              .toLowerCase()
              .includes($('asset-search').value.toLowerCase()),
        )
        .map((asset) => {
          const card = el('div', undefined, 'card');
          if (asset.kind === 'texture') {
            const img = el('img');
            img.src = '/api/assets/' + asset.id + '/png';
            img.alt = asset.name;
            card.append(img);
          }
          card.append(
            el('strong', asset.name),
            el(
              'small',
              asset.kind === 'texture'
                ? asset.width + ' × ' + asset.height
                : asset.cubes + (asset.kind === 'animated_model' ? ' 个立方体骨骼' : ' 个立方体'),
            ),
            el('small', asset.source + ' · ' + asset.license),
          );
          const edit = el('button', '载入编辑', 'secondary');
          edit.onclick = run(async () => {
            const data = await api('/api/assets/' + asset.id);
            $('asset-source').value = asset.source;
            $('asset-license').value = asset.license;
            if (asset.kind === 'texture') {
              size = data.data.width;
              pixels = [...data.data.pixels];
              undo = [];
              $('texture-size').value = String(size);
              $('texture-name').value = asset.name;
              drawPixels();
            } else if (asset.kind === 'animated_model') {
              animationEditor.set(data.data);
              $('animation-name').value = asset.name;
            } else {
              modelEditor.set(data.data);
              $('model-name').value = asset.name;
            }
            feedback('已载入；再次保存会创建新资源，保留旧工程引用。');
          });
          card.append(
            edit,
            download(
              '/api/assets/' + asset.id + '/' + (asset.kind === 'texture' ? 'png' : 'bbmodel'),
              '导出 ' + (asset.kind === 'texture' ? 'PNG' : 'bbmodel'),
            ),
          );
          return card;
        }),
    );
  }
  let searchTimer;
  $('asset-search').oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshAssets().catch((e) => feedback(e.message, true)), 200);
  };
  $('asset-package-import').onchange = run(async () => {
    const file = $('asset-package-import').files[0];
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) throw new Error('资源包最多 32 MiB。');
    await request('/api/asset-packages', 'POST', JSON.parse(await file.text()));
    await refreshAssets();
    $('asset-package-import').value = '';
    feedback('资源包已校验并导入，保留来源和许可，创建了新的资源 ID。');
  });
  api('/api/catalog')
    .then(({ entries }) => {
      $('catalog-list').replaceChildren(
        ...entries.map((entry) => {
          const card = el('article', undefined, 'card');
          card.append(
            el('strong', entry.title),
            el('p', entry.description),
            el('small', entry.author + ' · ' + entry.license),
          );
          const button = el('button', '导入此素材组', 'secondary');
          button.onclick = run(async () => {
            await request('/api/catalog/' + entry.id + '/import');
            await refreshAssets();
            feedback('素材组已加入资源库，可继续编辑并绑定内容。');
          });
          card.append(button);
          return card;
        }),
      );
    })
    .catch((e) => feedback(e.message, true));
  initEntityEditor({ readSpec, stage, run, getProject });
  initLootEditor({ readSpec, stage, run });
  // Immutable source snapshots and explicit build permission.
  async function loadWorkspace(hash, epoch = requestEpoch) {
    const id = getProject()?.id;
    const ticket = ++fileEpoch;
    snapshot = null;
    $('source-panel').hidden = true;
    controls();
    if (!hash) return;
    const data = await api('/api/projects/' + id + '/workspaces/' + hash);
    if (epoch !== requestEpoch || id !== getProject()?.id || ticket !== fileEpoch) return;
    snapshot = data;
    $('source-panel').hidden = false;
    $('workspace-hash').textContent = 'SHA-256 ' + data.hash + ' · ' + data.template.id;
    $('source-download').href = '/api/projects/' + id + '/workspaces/' + hash + '/source';
    $('workspace-diff').replaceChildren(
      ...data.changes.map((change) =>
        el(
          'li',
          { added: '新增', modified: '修改', removed: '删除' }[change.change] + ' · ' + change.path,
        ),
      ),
    );
    $('source-file').replaceChildren(
      option('', '选择要审查的文件'),
      ...data.files
        .filter((f) => !f.path.endsWith('.png') && !f.path.endsWith('.jar'))
        .map((f) => option(f.path, f.path)),
    );
    $('source-preview').textContent = '';
    controls();
  }
  $('workspace-select').onchange = run(() => loadWorkspace($('workspace-select').value));
  $('source-file').onchange = run(async () => {
    const path = $('source-file').value;
    if (!path || !snapshot) return;
    const id = getProject().id,
      hash = snapshot.hash,
      ticket = ++fileEpoch;
    const file = await api(
      '/api/projects/' + id + '/workspaces/' + hash + '/file?path=' + encodeURIComponent(path),
    );
    if (getProject()?.id === id && snapshot?.hash === hash && ticket === fileEpoch)
      $('source-preview').textContent = file.content;
  });
  $('generate-workspace').onclick = run(async () => {
    if (isDirty()) throw new Error('请先保存并确认规格。');
    const data = await request(projectRoot() + '/workspaces', 'POST', {
      revision: getProject().revision,
    });
    show(data.project);
    await refresh();
    feedback('完整工程已生成。请审查差异和源码后批准构建。');
  });
  $('approve-workspace').onclick = run(async () => {
    if (!snapshot) return;
    show(
      await request(projectRoot() + '/workspaces/' + snapshot.hash + '/approve', 'POST', {
        revision: getProject().revision,
      }),
    );
    await refresh();
    feedback('已批准此快照。现在可以选择是否联网并开始构建。');
  });
  $('check-builder').onclick = run(async () => {
    const status = await api('/api/builder', { signal: AbortSignal.timeout(35000) });
    $('builder-status').textContent =
      (status.available ? 'Docker ' + status.dockerVersion + ' · ' : '') +
      (status.imageReady ? '构建镜像就绪' : status.reason);
  });
  $('prepare-builder').onclick = run(async () => {
    if (!$('prepare-consent').checked) throw new Error('请勾选允许下载固定镜像。');
    const record = await request('/api/builder/prepare', 'POST', {
      allowNetwork: true,
      targetId:
        getProject().target.edition === 'java'
          ? getProject().target.loader + '-' + getProject().target.minecraft
          : undefined,
    });
    $('prepare-consent').checked = false;
    watch(record.id);
  });
  $('start-build').onclick = run(async () => {
    const p = getProject();
    const record = await request(projectRoot() + '/builds', 'POST', {
      revision: p.revision,
      snapshotHash: p.workspaceHash,
      allowNetwork: $('build-network').checked,
    });
    $('build-network').checked = false;
    watch(record.id);
    feedback(
      p.target.edition === 'bedrock'
        ? 'Bedrock 本地打包任务已启动。'
        : '构建任务已启动。日志来自真实 Docker / Gradle。',
    );
  });
  $('cancel-build').onclick = run(async () => {
    if (activeBuild) await request('/api/builds/' + activeBuild + '/cancel');
    feedback('已请求取消构建，正在等待容器退出。');
  });
  const terminal = new Set(['passed', 'failed', 'cancelled', 'timed_out', 'interrupted']);
  const statusName = {
    queued: '排队',
    running: '运行中',
    passed: '通过',
    failed: '失败',
    cancelled: '已取消',
    timed_out: '超时',
    interrupted: '服务重启中断',
  };
  function displayBuild(record) {
    $('build-state').textContent =
      (record.imported
        ? '外部导入记录 · 未本机重验证'
        : record.type === 'prepare'
          ? '镜像准备'
          : '构建') +
      ' · ' +
      (statusName[record.status] ?? record.status) +
      ' · ' +
      (record.snapshotHash?.slice(0, 12) ?? '') +
      (record.artifact ? ' · 产物 SHA-256 ' + record.artifact.sha256 + ' · 未做游戏实测' : '');
    $('build-log').textContent = record.log || '等待构建日志……';
    $('build-downloads').replaceChildren(
      download('/api/builds/' + record.id + '/report', '下载构建报告'),
    );
    if (record.artifact && record.status === 'passed')
      $('build-downloads').append(
        download(
          '/api/builds/' + record.id + '/artifact',
          record.artifact.format === 'mcaddon' ? '下载 MCADDON' : '下载 JAR',
        ),
        download('/api/builds/' + record.id + '/bundle', '下载交付包（源码 + 产物 + 报告）'),
      );
  }
  function watch(id) {
    clearTimeout(pollTimer);
    activeBuild = id;
    $('cancel-build').hidden = false;
    controls();
    const epoch = requestEpoch;
    const tick = async () => {
      try {
        const record = await api('/api/builds/' + id);
        if (activeBuild !== id || epoch !== requestEpoch) return;
        displayBuild(record);
        if (terminal.has(record.status)) {
          activeBuild = null;
          $('cancel-build').hidden = true;
          await refreshBuilds(epoch);
          controls();
        } else pollTimer = setTimeout(tick, 1500);
      } catch (error) {
        if (epoch !== requestEpoch) return;
        feedback('构建状态读取失败：' + error.message, true);
        pollTimer = setTimeout(tick, 3000);
      }
    };
    void tick();
  }
  async function refreshBuilds(epoch = requestEpoch) {
    const id = getProject()?.id;
    if (!id) return;
    const { builds } = await api('/api/projects/' + id + '/builds');
    if (epoch !== requestEpoch || getProject()?.id !== id) return;
    const chosen = $('repair-build').value;
    $('repair-build').replaceChildren(
      option('', '不附加构建日志'),
      ...builds
        .filter((b) => b.status === 'failed')
        .map((b) =>
          option(
            b.id,
            new Date(b.createdAt).toLocaleString() + ' · ' + b.snapshotHash.slice(0, 12),
          ),
        ),
    );
    $('repair-build').value = chosen;
    $('build-history').replaceChildren(
      ...builds.map((record) => {
        const li = el('li');
        li.append(
          el(
            'span',
            new Date(record.createdAt).toLocaleString() +
              ' · ' +
              statusName[record.status] +
              ' · ' +
              record.snapshotHash.slice(0, 12),
          ),
        );
        const view = el('button', '查看日志与下载', 'secondary');
        view.onclick = run(async () => {
          if (!terminal.has(record.status)) {
            watch(record.id);
            return;
          }
          const currentEpoch = requestEpoch;
          const data = await api('/api/builds/' + record.id);
          if (currentEpoch === requestEpoch) displayBuild(data);
        });
        li.append(view);
        return li;
      }),
    );
    const running = builds.find((b) => !terminal.has(b.status));
    if (running && !activeBuild) watch(running.id);
  }
  document.addEventListener('project-shown', (event) => {
    const epoch = ++requestEpoch;
    clearTimeout(pollTimer);
    activeBuild = null;
    snapshot = null;
    editing = null;
    $('cancel-build').hidden = true;
    $('build-log').textContent = '';
    $('build-state').textContent = '';
    $('build-downloads').replaceChildren();
    $('source-panel').hidden = true;
    $('workshop').hidden = false;
    for (const option of $('content-kind').options)
      option.disabled =
        event.detail.target.edition === 'bedrock' &&
        !['basic_item', 'food', 'block'].includes(option.value);
    const target = event.detail.target;
    api('/api/registries/items?target=' + target.loader + '-' + target.minecraft)
      .then((result) => {
        if (epoch === requestEpoch) {
          vanillaIds = result.items;
          renderContent();
        }
      })
      .catch((e) => feedback(e.message, true));
    resetContent();
    renderContent();
    controls();
    void (async () => {
      await refreshAssets();
      const { workspaces } = await api('/api/projects/' + event.detail.id + '/workspaces');
      if (epoch !== requestEpoch) return;
      $('workspace-select').replaceChildren(
        option('', '选择工程快照'),
        ...workspaces.map((s) =>
          option(
            s.hash,
            new Date(s.createdAt).toLocaleString() +
              ' · ' +
              s.hash.slice(0, 12) +
              ' · ' +
              s.files.length +
              ' 文件',
          ),
        ),
      );
      $('workspace-select').value = event.detail.workspaceHash ?? '';
      await loadWorkspace($('workspace-select').value, epoch);
      await refreshBuilds(epoch);
    })().catch((error) => feedback(error.message, true));
  });
  drawPixels();
  kindFields();
}
