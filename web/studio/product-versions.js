const $ = (id) => document.getElementById(id);
const node = (tag, text) => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};
export function initProductVersions({ api, getProject, isDirty, isBusy, show, refresh, feedback }) {
  let serial = 0;
  async function load() {
    const project = getProject(),
      request = ++serial;
    if (!project) return;
    try {
      const { versions } = await api('/api/projects/' + project.id + '/versions');
      if (request !== serial || getProject()?.id !== project.id) return;
      $('product-versions-list').replaceChildren(
        ...versions.map((version) => {
          const card = node('article', '');
          card.className = 'card';
          card.append(
            node('strong', version.label),
            node(
              'small',
              new Date(version.createdAt).toLocaleString() + ' · ' + version.assetCount + ' 项素材',
            ),
          );
          if (version.workspaceHash) {
            const source = node('a', '下载该版源码');
            source.href =
              '/api/projects/' + project.id + '/workspaces/' + version.workspaceHash + '/source';
            source.download = '';
            card.append(source);
          }
          for (const id of version.buildIds) {
            const artifact = node('a', '下载该版作品');
            artifact.href = '/api/builds/' + id + '/artifact';
            artifact.download = '';
            card.append(artifact);
          }
          const restore = node('button', '恢复完整作品');
          restore.type = 'button';
          restore.className = 'secondary';
          restore.onclick = async () => {
            try {
              if (isDirty() || isBusy()) throw new Error('请先保存编辑并等待当前操作结束。');
              const p = getProject();
              if (p?.id !== project.id) return;
              const restored = await api(
                '/api/projects/' + p.id + '/versions/' + version.id + '/restore',
                { method: 'POST', body: JSON.stringify({ revision: p.revision }) },
              );
              show(restored);
              await refresh();
              feedback(
                '完整作品已恢复，恢复前的状态也已保存。旧源码和产物可继续下载；执行构建前请重新确认。',
              );
            } catch (e) {
              feedback(e.message, true);
            }
          };
          card.append(restore);
          return card;
        }),
      );
      if (!versions.length)
        $('product-versions-list').append(
          node('p', '一句话创作每轮自动保存完整版本；也可随时手工保存。'),
        );
    } catch (e) {
      if (request === serial) feedback(e.message, true);
    }
  }
  $('product-version-save').onclick = async () => {
    try {
      const p = getProject();
      if (!p || isBusy() || isDirty()) throw new Error('请先保存规格并等待当前操作结束。');
      await api('/api/projects/' + p.id + '/versions', {
        method: 'POST',
        body: JSON.stringify({
          revision: p.revision,
          label: $('product-version-label').value || '手工保存作品',
        }),
      });
      await load();
      feedback('已保存规格、会话、素材、当前工程与成功产物的完整作品版本。');
    } catch (e) {
      feedback(e.message, true);
    }
  };
  document.addEventListener('project-shown', () => void load());
  document.addEventListener('product-versions-changed', () => void load());
}
