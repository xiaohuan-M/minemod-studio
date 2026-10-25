const $ = (id) => document.getElementById(id);
const node = (tag, text) => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
export function initCreation({
  api,
  getProvider,
  getProject,
  isDirty,
  show,
  refresh,
  feedback,
  setRunning,
}) {
  let current = null,
    timer = null,
    serial = 0;
  const status = {
    queued: '等待执行',
    running: '正在制作',
    passed: '构建完成',
    failed: '需要处理',
    cancelled: '已取消',
    interrupted: '已中断',
  };
  function providerInfo() {
    const p = getProvider();
    $('creation-provider').textContent = p?.configured
      ? p.baseUrl + ' · ' + p.model
      : '请先在上方“模型与 API 设置”启用文本服务。无需额外图片服务也可生成像素贴图。';
    $('creation-approved').checked = false;
  }
  function policy() {
    const p = getProvider();
    if (!p?.configured) throw new Error('请先启用自己的文本模型服务。');
    if (!$('creation-approved').checked) throw new Error('请确认本轮自动创作范围与调用上限。');
    return {
      consent: p.configurationId,
      approved: true,
      allowNetwork: $('creation-network').checked,
      textures: $('creation-textures').checked,
      models: $('creation-models').checked,
      code: $('creation-code').checked,
      maxCalls: Number($('creation-max-calls').value),
      maxRepairs: Number($('creation-repairs').value),
    };
  }
  function draw(task) {
    current = task;
    const running = ['queued', 'running'].includes(task.status);
    setRunning(running);
    $('creation-status').textContent =
      status[task.status] +
      ' · ' +
      task.calls.length +
      '/' +
      task.options.maxCalls +
      ' 次模型调用 · ' +
      task.repairs +
      ' 轮修复';
    $('creation-cancel').hidden = !running;
    $('creation-resume').hidden = !['failed', 'cancelled', 'interrupted'].includes(task.status);
    const known = task.calls.filter((c) => c.usage),
      unknown = task.calls.filter(
        (c) => c.usage?.inputTokens == null || c.usage?.outputTokens == null,
      ).length;
    $('creation-usage').textContent =
      '已知 token：输入 ' +
      known.reduce((n, c) => n + (c.usage.inputTokens ?? 0), 0) +
      ' / 输出 ' +
      known.reduce((n, c) => n + (c.usage.outputTokens ?? 0), 0) +
      (unknown ? '；' + unknown + ' 次调用用量未知' : '') +
      '。费用由模型服务商计费。';
    $('creation-events').replaceChildren(
      ...task.events.map((event) => node('li', event.seq + '. ' + event.message)),
    );
    $('creation-downloads').replaceChildren();
    if (task.snapshotHash) {
      const link = node('a', '下载本轮源码');
      link.href =
        '/api/projects/' + task.projectId + '/workspaces/' + task.snapshotHash + '/source';
      link.download = '';
      $('creation-downloads').append(link);
    }
    if (task.status === 'passed' && task.buildId)
      for (const [path, label] of [
        ['artifact', '下载作品'],
        ['bundle', '下载完整交付包'],
      ]) {
        const link = node('a', label);
        link.href = '/api/builds/' + task.buildId + '/' + path;
        link.download = '';
        $('creation-downloads').append(link);
      }
    $('creation-error').textContent = task.error?.message ?? '';
  }
  async function poll(id, request) {
    try {
      const task = await api('/api/creations/' + id);
      if (request !== serial || getProject()?.id !== task.projectId) return;
      draw(task);
      if (['queued', 'running'].includes(task.status))
        timer = setTimeout(() => void poll(id, request), 600);
      else {
        if (!isDirty()) show(await api('/api/projects/' + task.projectId));
        await refresh();
        document.dispatchEvent(new CustomEvent('product-versions-changed'));
      }
    } catch (e) {
      if (request === serial) {
        feedback(e.message, true);
        timer = setTimeout(() => void poll(id, request), 2000);
      }
    }
  }
  async function begin(task) {
    clearTimeout(timer);
    const request = ++serial;
    draw(task);
    $('creation-approved').checked = false;
    timer = setTimeout(() => void poll(task.id, request), 100);
  }
  $('create-automatically').onclick = async () => {
    try {
      if (isDirty()) throw new Error('请先保存当前项目的编辑。');
      const options = policy();
      const result = await api('/api/creations', {
        method: 'POST',
        body: JSON.stringify({
          ...options,
          name: $('name').value || undefined,
          prompt: $('prompt').value,
          targetId: $('target-select').value,
        }),
      });
      show(result.project);
      await begin(result.task);
      await refresh();
      feedback('自动创作已开始，关闭或刷新网页不会取消任务。');
    } catch (e) {
      feedback(e.message, true);
    }
  };
  $('creation-continue').onclick = async () => {
    try {
      const p = getProject();
      if (!p || isDirty()) throw new Error('请先保存当前编辑。');
      const task = await api('/api/projects/' + p.id + '/creations', {
        method: 'POST',
        body: JSON.stringify({
          ...policy(),
          revision: p.revision,
          instruction: $('revision-instruction').value,
        }),
      });
      await begin(task);
    } catch (e) {
      feedback(e.message, true);
    }
  };
  $('creation-cancel').onclick = async () => {
    try {
      if (current)
        await api('/api/creations/' + current.id + '/cancel', { method: 'POST', body: '{}' });
    } catch (e) {
      feedback(e.message, true);
    }
  };
  $('creation-resume').onclick = async () => {
    try {
      if (!current) return;
      const options = policy(),
        p = await api('/api/projects/' + current.projectId);
      const task = await api('/api/creations/' + current.id + '/resume', {
        method: 'POST',
        body: JSON.stringify({
          approved: true,
          consent: options.consent,
          revision: p.revision,
          maxCalls: options.maxCalls,
          maxRepairs: options.maxRepairs,
          allowNetwork: options.allowNetwork,
        }),
      });
      await begin(task);
    } catch (e) {
      feedback(e.message, true);
    }
  };
  document.addEventListener('providers-changed', providerInfo);
  document.addEventListener('provider-loaded', providerInfo);
  let displayed = null;
  document.addEventListener('project-shown', async ({ detail: p }) => {
    if (displayed === p.id) return;
    displayed = p.id;
    clearTimeout(timer);
    const request = ++serial;
    current = null;
    setRunning(false);
    $('creation-events').replaceChildren();
    $('creation-downloads').replaceChildren();
    $('creation-status').textContent = '尚无自动创作任务';
    $('creation-cancel').hidden = true;
    $('creation-resume').hidden = true;
    try {
      const { tasks } = await api('/api/projects/' + p.id + '/creations');
      if (request === serial && tasks[0]) await begin(tasks[0]);
    } catch (e) {
      feedback(e.message, true);
    }
  });
  providerInfo();
}
