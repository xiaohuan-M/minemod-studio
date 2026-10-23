const $ = (id) => document.getElementById(id);
const el = (tag, text) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
export function initImageStudio({ api, request, run, assetPayload, refreshAssets, feedback }) {
  let provider = null,
    pending = null,
    controller = null;
  const reloadProvider = () =>
    api('/api/image-provider')
      .then((info) => {
        provider = info;
        $('image-consent').checked = false;
        $('image-provider-info').textContent = info.configured
          ? info.baseUrl + ' · ' + info.model
          : '尚未配置图像服务；请在页面上方模型设置中启用。PNG 导入、保存、像素转换均可离线使用。';
      })
      .catch((e) => feedback(e.message, true));
  void reloadProvider();
  document.addEventListener('providers-changed', reloadProvider);
  const show = (data) => {
    pending = data;
    $('image-preview').src = 'data:image/png;base64,' + data.png;
    $('image-preview').hidden = false;
    $('image-save').disabled = false;
  };
  $('image-import').onchange = run(async () => {
    const file = $('image-import').files[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) throw new Error('PNG 不得超过 6 MiB。');
    const png = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const saved = await request(
      '/api/assets',
      'POST',
      assetPayload('image', file.name.slice(0, 80), { png }),
    );
    show(saved.data);
    $('image-name').value = saved.name;
    await refreshAssets();
    feedback('PNG 已校验并保存到本地图片库。');
  });
  $('image-generate').onclick = run(async () => {
    if (!provider?.configured) throw new Error('请在模型设置中启用独立图像服务。');
    if (!$('image-consent').checked) throw new Error('请确认本次发送描述和所选参考图。');
    if (controller) throw new Error('已有图片请求。');
    controller = new AbortController();
    $('image-cancel').hidden = false;
    feedback('正在请求图像服务……');
    try {
      const result = await api('/api/image-provider/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt: $('image-prompt').value,
          view: $('image-view').value,
          referenceId: $('image-reference').value || undefined,
          consent: provider.configurationId,
        }),
        signal: controller.signal,
      });
      show(result.data);
      $('asset-source').value = 'Image API: ' + result.source.model;
      $('asset-license').value = '待用户核对服务商条款';
      feedback('图片已返回。请核对内容与素材许可后保存。');
    } finally {
      controller = null;
      $('image-cancel').hidden = true;
      $('image-consent').checked = false;
    }
  });
  $('image-cancel').onclick = () => controller?.abort();
  $('image-save').onclick = run(async () => {
    if (!pending) throw new Error('请先导入或生成图片。');
    await request('/api/assets', 'POST', assetPayload('image', $('image-name').value, pending));
    await refreshAssets();
    feedback('图片已保存在本地。');
  });
  document.addEventListener('assets-loaded', ({ detail: assets }) => {
    const images = assets.filter((a) => a.kind === 'image'),
      selected = $('image-reference').value;
    $('image-reference').replaceChildren(
      ...[{ id: '', name: '不发送参考图' }, ...images].map((a) => {
        const o = el('option', a.name);
        o.value = a.id;
        return o;
      }),
    );
    $('image-reference').value = selected;
    $('image-library').replaceChildren(
      ...images.map((a) => {
        const card = el('article');
        card.className = 'card';
        const img = el('img');
        img.src = '/api/assets/' + a.id + '/png';
        img.alt = a.name;
        card.append(
          img,
          el('strong', a.name),
          el('small', a.width + ' × ' + a.height + ' · ' + a.license),
        );
        const convert = el('button', '转换为像素贴图');
        convert.className = 'secondary';
        convert.onclick = run(async () => {
          await request('/api/assets/' + a.id + '/pixelize', 'POST', {
            size: Number($('image-pixel-size').value),
            colors: Number($('image-palette').value),
          });
          await refreshAssets();
          feedback('像素贴图已加入资源库，可载入像素编辑器继续调整。');
        });
        const reference = el('button', '用作参考图');
        reference.className = 'secondary';
        reference.onclick = () => {
          $('image-reference').value = a.id;
          feedback('参考图已选中，只有确认生成图片时才会发送。');
        };
        const link = el('a', '下载 PNG');
        link.href = img.src;
        link.download = '';
        card.append(convert, reference, link);
        return card;
      }),
    );
  });
}
