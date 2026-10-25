import { modelPreview } from '../model-preview.js';
import { sampleClip } from './animation-timeline.js';
const $ = (id) => document.getElementById(id);
const option = (value, text) => {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
};
export function initAnimationEditor({
  request,
  run,
  assetPayload,
  refreshAssets,
  feedback,
  getModel,
  getPixels,
}) {
  let animation = null,
    playing = false,
    frame = 0,
    last = 0,
    texture = null;
  const preview = modelPreview($('animation-canvas'), (index) => {
    $('animation-bone').value = String(index);
    loadKey();
  });
  const clip = () => animation?.clips[Number($('animation-clip').value) || 0];
  const time = () => Number($('animation-time').value);
  const stop = () => {
    playing = false;
    cancelAnimationFrame(frame);
    $('animation-play').textContent = '播放';
  };
  const vector = (id) => {
    const v = $(id).value.split(',').map(Number);
    if (v.length !== 3 || v.some((n) => !Number.isFinite(n)))
      throw new Error('关键帧变换需要三个数值。');
    return v;
  };
  function draw() {
    if (!animation) return;
    preview.animate(sampleClip(clip(), time()));
    $('animation-clock').textContent =
      time().toFixed(2) + ' / ' + clip().duration.toFixed(2) + ' 秒';
  }
  function loadKey() {
    if (!animation) return;
    const pose = sampleClip(clip(), time())[Number($('animation-bone').value)] ?? {};
    for (const [key, value] of [
      ['rotation', [0, 0, 0]],
      ['translation', [0, 0, 0]],
      ['scale', [1, 1, 1]],
    ])
      $('animation-' + key).value = (pose[key] ?? value)
        .map((n) => Math.round(n * 1000) / 1000)
        .join(',');
    preview.select(Number($('animation-bone').value));
  }
  function keys() {
    const track = clip()?.tracks.find((t) => t.element === Number($('animation-bone').value));
    $('animation-keyframes').replaceChildren(
      ...(track?.keyframes ?? []).map((k) => {
        const button = document.createElement('button');
        button.className = 'secondary';
        button.textContent = k.time.toFixed(2) + ' 秒';
        button.onclick = () => {
          stop();
          $('animation-time').value = String(k.time);
          draw();
          loadKey();
        };
        return button;
      }),
    );
  }
  function controls() {
    if (!animation) return;
    $('animation-time').max = String(clip().duration);
    $('animation-duration').value = String(clip().duration);
    $('animation-loop').checked = clip().loop;
    $('animation-clip-name').value = clip().name;
    keys();
    draw();
    loadKey();
  }
  function set(value) {
    stop();
    animation = structuredClone(value);
    texture = animation.texture ?? null;
    preview.texture(texture);
    $('animation-clip').replaceChildren(
      ...animation.clips.map((c, i) => option(String(i), c.name)),
    );
    $('animation-bone').replaceChildren(
      ...animation.elements.map((_, i) => option(String(i), '骨骼 cube_' + i)),
    );
    $('animation-time').value = '0';
    preview.set(animation);
    controls();
    $('animation-controls').hidden = false;
  }
  $('animation-create').onclick = run(() => {
    const model = getModel();
    set({
      elements: model.elements,
      ...(model.texture ? { texture: model.texture } : {}),
      clips: [{ name: 'walk', duration: 1, loop: true, tracks: [] }],
    });
    feedback('已为当前立方体模型创建平面骨骼。移动时间、设置变换并保存关键帧。');
  });
  $('animation-bone').onchange = () => {
    keys();
    loadKey();
  };
  $('animation-clip').onchange = () => {
    stop();
    $('animation-time').value = '0';
    controls();
  };
  $('animation-time').oninput = () => {
    stop();
    draw();
    loadKey();
  };
  $('animation-play').onclick = () => {
    if (!animation) return;
    if (playing) {
      stop();
      return;
    }
    if (time() >= clip().duration) $('animation-time').value = '0';
    playing = true;
    last = performance.now();
    $('animation-play').textContent = '暂停';
    const tick = (now) => {
      if (!playing) return;
      let next = time() + (now - last) / 1000;
      last = now;
      if (next > clip().duration) {
        if (clip().loop) next %= clip().duration;
        else {
          next = clip().duration;
          stop();
        }
      }
      $('animation-time').value = String(next);
      draw();
      if (playing) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  $('animation-save-key').onclick = run(() => {
    if (!animation) throw new Error('请先创建或载入动画。');
    stop();
    const element = Number($('animation-bone').value),
      key = {
        time: Math.round(time() * 1000) / 1000,
        rotation: vector('animation-rotation'),
        translation: vector('animation-translation'),
        scale: vector('animation-scale'),
      };
    if (
      key.rotation.some((n) => Math.abs(n) > 360) ||
      key.translation.some((n) => Math.abs(n) > 80) ||
      key.scale.some((n) => n < 0.01 || n > 4)
    )
      throw new Error('旋转范围 ±360，位移 ±80，缩放 0.01–4。');
    let track = clip().tracks.find((t) => t.element === element);
    if (!track) {
      track = { element, keyframes: [] };
      clip().tracks.push(track);
    }
    track.keyframes = track.keyframes.filter((k) => k.time !== key.time);
    track.keyframes.push(key);
    track.keyframes.sort((a, b) => a.time - b.time);
    keys();
    draw();
    feedback('关键帧已写入动画草稿。');
  });
  $('animation-delete-key').onclick = run(() => {
    const track = clip()?.tracks.find((t) => t.element === Number($('animation-bone').value));
    if (!track) return;
    track.keyframes = track.keyframes.filter((k) => Math.abs(k.time - time()) > 0.001);
    clip().tracks = clip().tracks.filter((t) => t.keyframes.length);
    keys();
    draw();
    loadKey();
  });
  $('animation-update-clip').onclick = run(() => {
    if (!animation) return;
    const name = $('animation-clip-name').value.trim(),
      duration = Number($('animation-duration').value);
    if (
      !/^[a-z][a-z0-9_]{0,47}$/.test(name) ||
      animation.clips.some((c) => c !== clip() && c.name === name) ||
      duration < 0.1 ||
      duration > 30 ||
      !Number.isFinite(duration)
    )
      throw new Error('片段名须唯一，长度为 0.1–30 秒。');
    if (clip().tracks.some((t) => t.keyframes.some((k) => k.time > duration)))
      throw new Error('请先删除超出新长度的关键帧。');
    Object.assign(clip(), { name, duration, loop: $('animation-loop').checked });
    $('animation-clip').selectedOptions[0].textContent = name;
    controls();
  });
  $('animation-add-clip').onclick = run(() => {
    if (!animation) return;
    if (animation.clips.length >= 8) throw new Error('最多 8 个动画片段。');
    const old = animation.clips.length;
    let n = old + 1;
    while (animation.clips.some((c) => c.name === 'clip_' + n)) n++;
    animation.clips.push({ name: 'clip_' + n, duration: 1, loop: true, tracks: [] });
    $('animation-clip').append(option(String(old), 'clip_' + n));
    $('animation-clip').value = String(old);
    $('animation-time').value = '0';
    controls();
  });
  $('animation-texture').onclick = () => {
    texture = structuredClone(getPixels());
    if (animation) animation.texture = structuredClone(texture);
    preview.texture(texture);
    draw();
  };
  $('animation-save').onclick = run(async () => {
    if (!animation) throw new Error('请先创建动画。');
    const saved = await request(
      '/api/assets',
      'POST',
      assetPayload('animated_model', $('animation-name').value, animation),
    );
    set(saved.data);
    await refreshAssets();
    feedback('动画素材已保存，可绑定 Bedrock 实体或导出 bbmodel。');
  });
  $('animation-export').onclick = run(async () => {
    if (!animation) return;
    const bb = await request('/api/blockbench/export', 'POST', {
      kind: 'animated_model',
      model: animation,
      name: $('animation-name').value,
      ...(texture ? { texture } : {}),
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bb, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'animated-model.bbmodel';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('animation-import').onchange = run(async () => {
    const file = $('animation-import').files[0];
    if (!file) return;
    if (file.size > 800 * 1024) throw new Error('文件不能超过 800 KiB。');
    const model = JSON.parse(await file.text());
    if (!model.animations?.length) throw new Error('这是静态模型，请在模型工坊导入。');
    const result = await request('/api/blockbench/import', 'POST', {
      model,
      name: file.name.slice(0, 80),
      source: $('asset-source').value,
      license: $('asset-license').value,
    });
    const saved = result.assets.find((a) => a.kind === 'animated_model');
    set(saved.data);
    const tex = result.assets.find((a) => a.kind === 'texture');
    if (tex) {
      texture = tex.data;
      preview.texture(texture);
    }
    await refreshAssets();
    feedback('动画与嵌入贴图已导入。');
  });
  return {
    get() {
      return animation ? structuredClone(animation) : null;
    },
    set(value) {
      set(value);
      $('animation-studio').open = true;
    },
  };
}
