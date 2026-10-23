const $ = (id) => document.getElementById(id);
const option = (value, text) => {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
};
export function initProviderSettings({ api }) {
  let state = null,
    editing = null,
    busy = false;
  const status = (message, error = false) => {
    $('settings-status').textContent = message;
    $('settings-status').classList.toggle('error', error);
  };
  const showKind = () => {
    const image = $('profile-kind').value === 'image';
    $('profile-text-options').hidden = image;
    $('profile-image-options').hidden = !image;
    $('profile-timeout').max = image ? '180000' : '120000';
  };
  function reset() {
    editing = null;
    $('provider-profile-form').reset();
    $('profile-kind').disabled = false;
    $('profile-key').placeholder = '仅提交到本机服务；编辑时留空保留';
    $('profile-form-title').textContent = '新增服务配置';
    showKind();
  }
  function edit(profile) {
    reset();
    editing = profile.id;
    for (const key of ['name', 'kind', 'model']) $('profile-' + key).value = profile[key];
    $('profile-base-url').value = profile.baseUrl;
    $('profile-kind').disabled = true;
    $('profile-timeout').value = profile.options.timeoutMs;
    $('profile-max-tokens').value = profile.options.maxTokens ?? 4096;
    $('profile-json-mode').checked = profile.options.jsonMode ?? true;
    $('profile-token-field').value = profile.options.tokenField ?? 'max_tokens';
    $('profile-response-format').value = profile.options.responseFormat ?? 'b64_json';
    $('profile-form-title').textContent = '编辑：' + profile.name;
    $('profile-key').placeholder = profile.hasApiKey
      ? '已保存；留空保留原密钥'
      : '本机端点可以留空';
    showKind();
    $('profile-name').focus();
  }
  const run = (operation) => async (event) => {
    event?.preventDefault();
    if (busy || !state) return;
    busy = true;
    $('provider-settings-fields').disabled = true;
    try {
      await operation();
    } catch (error) {
      status(error.message, true);
      // Refresh only metadata so a stale tab can recover without discarding its nonsecret draft.
      try {
        await load();
      } catch {
        /* Preserve the original error. */
      }
    } finally {
      busy = false;
      $('provider-settings-fields').disabled = false;
    }
  };
  function render() {
    for (const kind of ['text', 'image']) {
      const fallback = state.environment[kind];
      $('active-' + kind + '-profile').replaceChildren(
        option(
          '',
          fallback.configured ? '环境变量：' + fallback.model : '环境变量（未配置，使用离线功能）',
        ),
        ...state.profiles
          .filter((p) => p.kind === kind)
          .map((p) => option(p.id, p.name + ' · ' + p.model)),
      );
      $('active-' + kind + '-profile').value = state.active[kind] ?? '';
    }
    $('provider-profiles-list').replaceChildren(
      ...state.profiles.map((profile) => {
        const card = document.createElement('article');
        card.className = 'card';
        card.dataset.profileId = profile.id;
        const title = document.createElement('strong');
        title.textContent = profile.name;
        const detail = document.createElement('p');
        detail.textContent =
          (profile.kind === 'text' ? '文本' : '图像') +
          ' · ' +
          profile.model +
          ' · ' +
          profile.baseUrl +
          ' · ' +
          (profile.hasApiKey ? '已保存密钥' : '无密钥') +
          (state.active[profile.kind] === profile.id ? ' · 正在使用' : '');
        const change = document.createElement('button');
        change.type = 'button';
        change.className = 'secondary';
        change.textContent = '编辑配置';
        change.onclick = () => edit(profile);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'secondary';
        remove.textContent = '删除配置';
        remove.disabled = state.active[profile.kind] === profile.id;
        remove.onclick = run(async () => {
          if (!window.confirm('删除服务配置“' + profile.name + '”及其保存的密钥？')) return;
          await mutate('/' + profile.id, 'DELETE', {});
          if (editing === profile.id) reset();
          status('服务配置已删除。');
        });
        card.append(title, detail, change, remove);
        return card;
      }),
    );
    $('provider-profiles-empty').hidden = !!state.profiles.length;
  }
  async function load() {
    state = await api('/api/settings/providers');
    render();
  }
  async function mutate(path, method, input) {
    state = await api('/api/settings/providers' + path, {
      method,
      body: JSON.stringify({ revision: state.revision, ...input }),
    });
    render();
    document.dispatchEvent(new Event('providers-changed'));
  }
  $('provider-profile-form').onsubmit = run(async () => {
    const kind = $('profile-kind').value;
    const options = {
      timeoutMs: Number($('profile-timeout').value),
      ...(kind === 'text'
        ? {
            maxTokens: Number($('profile-max-tokens').value),
            jsonMode: $('profile-json-mode').checked,
            tokenField: $('profile-token-field').value,
          }
        : { responseFormat: $('profile-response-format').value }),
    };
    const input = {
      name: $('profile-name').value,
      kind,
      baseUrl: $('profile-base-url').value,
      model: $('profile-model').value,
      options,
    };
    if ($('profile-clear-key').checked) input.apiKey = '';
    else if ($('profile-key').value) input.apiKey = $('profile-key').value;
    $('profile-key').value = ''; // Do not retain entered credentials after sending, even on failure.
    await mutate(editing ? '/' + editing : '', editing ? 'PUT' : 'POST', input);
    reset();
    status('配置已保存在本机。请选择要启用的服务；保存不会调用模型。');
  });
  for (const kind of ['text', 'image'])
    $('activate-' + kind + '-profile').onclick = run(async () => {
      await mutate('/activate', 'POST', {
        kind,
        profileId: $('active-' + kind + '-profile').value || null,
      });
      status('服务已切换，无需重启。请核对目标后重新确认调用。');
    });
  $('profile-reset').onclick = reset;
  $('settings-refresh').onclick = run(async () => {
    await load();
    document.dispatchEvent(new Event('providers-changed'));
  });
  $('profile-kind').onchange = () => {
    showKind();
    $('profile-timeout').value = $('profile-kind').value === 'image' ? '120000' : '45000';
  };
  $('provider-settings').addEventListener('toggle', () => {
    if (!$('provider-settings').open) $('profile-key').value = '';
  });
  load().catch((error) => status('设置读取失败：' + error.message, true));
}
