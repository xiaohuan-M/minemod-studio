import { modelPreview } from '../model-preview.js';
const $ = (id) => document.getElementById(id);
const option = (value, text) => {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
};
export function initModelEditor({
  api,
  request,
  run,
  assetPayload,
  refreshAssets,
  feedback,
  getPixels,
}) {
  // Static cube models can be exchanged with Blockbench; unsupported features fail validation.
  let previewTexture = null;
  let model = { elements: [{ from: [4, 0, 4], to: [12, 16, 12] }] };
  const preview = modelPreview($('model-canvas'), (index) => {
    $('cube-select').value = String(index);
    loadCube();
  });
  function renderCubes(index = 0) {
    $('cube-select').replaceChildren(
      ...model.elements.map((_, i) => option(String(i), '立方体 ' + (i + 1))),
    );
    $('cube-select').value = String(Math.min(index, model.elements.length - 1));
    loadCube();
    preview.set(model);
    preview.select(Number($('cube-select').value));
    loadDisplay();
  }
  function loadCube() {
    const cube = model.elements[Number($('cube-select').value)];
    if (cube) {
      $('cube-from').value = cube.from.join(',');
      $('cube-to').value = cube.to.join(',');
      $('cube-axis').value = cube.rotation?.axis ?? 'y';
      $('cube-angle').value = String(cube.rotation?.angle ?? 0);
      $('cube-origin').value = (cube.rotation?.origin ?? [8, 8, 8]).join(',');
      $('cube-rescale').checked = !!cube.rotation?.rescale;
      loadFace();
      preview.select(Number($('cube-select').value));
    }
  }
  function vector(id) {
    const v = $(id)
      .value.split(',')
      .map((s) => Number(s.trim()));
    if (v.length !== 3 || v.some((n) => !Number.isFinite(n) || n < -16 || n > 32))
      throw new Error('坐标需要是三个 -16–32 之间的数字，用逗号分开。');
    return v;
  }
  $('cube-select').onchange = loadCube;
  $('model-view').onchange = () => {
    preview.view($('model-view').value);
    loadDisplay();
  };
  $('cube-update').onclick = run(() => {
    const from = vector('cube-from'),
      to = vector('cube-to');
    if (from.some((n, i) => n >= to[i])) throw new Error('每个终点坐标必须大于起点。');
    const index = Number($('cube-select').value);
    model.elements[index] = {
      ...model.elements[index],
      from,
      to,
      rotation: {
        origin: vector('cube-origin'),
        axis: $('cube-axis').value,
        angle: Number($('cube-angle').value),
        rescale: $('cube-rescale').checked,
      },
    };
    renderCubes(index);
  });
  $('cube-add').onclick = run(() => {
    if (model.elements.length >= 128) throw new Error('最多 128 个立方体。');
    model.elements.push({ from: [6, 0, 6], to: [10, 4, 10] });
    renderCubes(model.elements.length - 1);
  });
  $('cube-delete').onclick = run(() => {
    if (model.elements.length <= 1) throw new Error('模型至少保留一个立方体。');
    model.elements.splice(Number($('cube-select').value), 1);
    renderCubes();
  });
  $('model-save').onclick = run(async () => {
    const saved = await request(
      '/api/assets',
      'POST',
      assetPayload('model', $('model-name').value, model),
    );
    model = saved.data;
    renderCubes();
    await refreshAssets();
    feedback('模型已保存，可绑定到物品，也可导出 bbmodel。');
  });
  $('model-import').onchange = run(async () => {
    const file = $('model-import').files[0];
    if (!file) return;
    if (file.size > 800 * 1024) throw new Error('模型文件最多 800 KiB。');
    const data = JSON.parse(await file.text());
    if (data.animations?.length) throw new Error('动画文件请使用动画工坊的导入入口。');
    if (data.meta || file.name.endsWith('.bbmodel')) {
      const result = await request('/api/blockbench/import', 'POST', {
        model: data,
        name: file.name.slice(0, 80),
        source: $('asset-source').value,
        license: $('asset-license').value,
      });
      const saved = result.assets.find((a) => a.kind === 'model'),
        texture = result.assets.find((a) => a.kind === 'texture');
      model = saved.data;
      $('model-name').value = saved.name;
      if (texture) {
        previewTexture = texture.data;
        preview.texture(previewTexture);
      }
    } else {
      const saved = await request(
        '/api/assets',
        'POST',
        assetPayload('model', file.name.slice(0, 80), data),
      );
      model = saved.data;
      $('model-name').value = saved.name;
    }
    renderCubes();
    await refreshAssets();
    feedback('模型与嵌入贴图已校验并导入资源库；可分别绑定物品。');
  });

  function loadFace() {
    const cube = model.elements[Number($('cube-select').value)];
    const face = cube?.faces?.[$('uv-face').value];
    $('uv-coordinates').value = (face?.uv ?? [0, 0, 16, 16]).join(',');
    $('uv-rotation').value = String(face?.rotation ?? 0);
    $('uv-hidden').checked = face === null;
  }
  $('uv-face').onchange = loadFace;
  $('uv-update').onclick = run(() => {
    const uv = $('uv-coordinates').value.split(',').map(Number);
    if (uv.length !== 4 || uv.some((v) => !Number.isFinite(v) || v < 0 || v > 16))
      throw new Error('UV 需要四个 0–16 之间的数字。');
    const cube = model.elements[Number($('cube-select').value)];
    cube.faces ??= {};
    cube.faces[$('uv-face').value] = $('uv-hidden').checked
      ? null
      : { uv, texture: '#0', rotation: Number($('uv-rotation').value) };
    renderCubes(Number($('cube-select').value));
  });
  const slot = () =>
    ({
      hand: 'thirdperson_righthand',
      head: 'head',
      gui: 'gui',
      ground: 'ground',
      body: 'body',
      cape: 'cape',
    })[$('model-view').value] ?? 'thirdperson_righthand';
  function loadDisplay() {
    const t = (['body', 'cape'].includes(slot()) ? model.preview : model.display)?.[slot()] ?? {};
    for (const [field, fallback] of [
      ['rotation', [0, 0, 0]],
      ['translation', [0, 0, 0]],
      ['scale', [1, 1, 1]],
    ])
      $('display-' + field).value = (t[field] ?? fallback).join(',');
  }
  $('display-update').onclick = run(() => {
    const t = {};
    for (const [field, min, max] of [
      ['rotation', -360, 360],
      ['translation', -80, 80],
      ['scale', 0, 4],
    ]) {
      const v = $('display-' + field)
        .value.split(',')
        .map(Number);
      if (v.length !== 3 || v.some((n) => !Number.isFinite(n) || n < min || n > max))
        throw new Error(field + ' 参数超出范围 ' + min + '–' + max);
      t[field] = v;
    }
    if (['body', 'cape'].includes(slot())) (model.preview ??= {})[slot()] = t;
    else (model.display ??= {})[slot()] = t;
    preview.set(model);
    feedback(
      ['body', 'cape'].includes(slot())
        ? '身体预览位置已更新，随 bbmodel 保存；游戏装备行为需对应的模组代码。'
        : '显示姿态已更新；保存模型后会写入导出的游戏模型。',
    );
  });
  $('model-texture-pixels').onclick = () => {
    previewTexture = structuredClone(getPixels());
    preview.texture(previewTexture);
    feedback('已使用当前像素画布预览；在内容编辑器中选择相同贴图即可用于游戏。');
  };
  $('model-export').onclick = run(async () => {
    const bb = await request('/api/blockbench/export', 'POST', {
      model,
      name: $('model-name').value,
      ...(previewTexture ? { texture: previewTexture } : {}),
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bb, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'model.bbmodel';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('model-screenshot').onclick = run(() => {
    const a = document.createElement('a');
    a.href = preview.capture();
    a.download = 'model-preview.png';
    a.click();
  });
  renderCubes();
  return {
    set(value) {
      model = structuredClone(value);
      renderCubes();
    },
    get() {
      return structuredClone(model);
    },
  };
}
