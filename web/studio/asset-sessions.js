const $ = (id) => document.getElementById(id);
const node = (tag, text) => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
export function initAssetSessions({
  api,
  getProvider,
  run,
  feedback,
  refreshAssets,
  getCurrent,
  load,
}) {
  let session = null,
    controller = null;
  async function refresh() {
    const { sessions } = await api('/api/asset-sessions');
    $('asset-session-select').replaceChildren(
      ...[{ id: '', name: '新建素材会话' }, ...sessions].map((s) => {
        const o = node('option', s.name + ' ' + (s.kind ?? ''));
        o.value = s.id;
        return o;
      }),
    );
    $('asset-session-select').value = session?.id ?? '';
  }
  function render() {
    $('asset-session-history').replaceChildren(
      ...(session?.history ?? []).map((step) => {
        const card = node('article', step.prompt),
          button = node('button', '恢复这个素材版本');
        button.type = 'button';
        button.className = 'secondary';
        button.onclick = run(async () => {
          session = await api('/api/asset-sessions/' + session.id + '/restore', {
            method: 'POST',
            body: JSON.stringify({ revision: session.revision, assetId: step.assetId }),
          });
          load(session.kind, session.data);
          render();
        });
        card.append(button);
        return card;
      }),
    );
  }
  $('asset-session-select').onchange = run(async () => {
    session = $('asset-session-select').value
      ? await api('/api/asset-sessions/' + $('asset-session-select').value)
      : null;
    if (session) {
      $('ai-asset-kind').value = session.kind;
      if (session.data) load(session.kind, session.data);
    }
    render();
  });
  $('ai-asset-kind').onchange = () => {
    session = null;
    $('asset-session-select').value = '';
    render();
  };
  $('ai-asset-cancel').onclick = () => controller?.abort();
  $('ai-asset-generate').onclick = run(async () => {
    const provider = getProvider();
    if (!provider?.configured) throw new Error('请先启用自己的文本服务。');
    if (!$('ai-asset-consent').checked)
      throw new Error('请确认发送本次描述、所选当前素材和参考图。');
    const kind = $('ai-asset-kind').value;
    if (!session)
      session = await api('/api/asset-sessions', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          name: $('ai-asset-prompt').value.trim().slice(0, 60) || '我的素材',
        }),
      });
    controller = new AbortController();
    $('ai-asset-cancel').hidden = false;
    try {
      session = await api('/api/asset-sessions/' + session.id + '/generate', {
        method: 'POST',
        body: JSON.stringify({
          revision: session.revision,
          consent: provider.configurationId,
          prompt: $('ai-asset-prompt').value,
          currentData: $('ai-asset-current').checked ? getCurrent(kind) : undefined,
          referenceId: $('ai-asset-reference').value || undefined,
        }),
        signal: controller.signal,
      });
      load(session.kind, session.data);
      $('ai-asset-current').checked = true;
      render();
      await refresh();
      await refreshAssets();
      feedback('素材已生成并保存。可手工编辑后继续描述修改，或恢复会话中的旧版本。');
    } finally {
      controller = null;
      $('ai-asset-cancel').hidden = true;
      $('ai-asset-consent').checked = false;
    }
  });
  void refresh().catch((e) => feedback(e.message, true));
}
