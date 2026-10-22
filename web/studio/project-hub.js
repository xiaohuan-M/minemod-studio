const $ = (id) => document.getElementById(id);
const node = (tag, text) => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};
export function initProjectHub({
  api,
  getProject,
  show,
  refresh,
  feedback,
  isBusy,
  isDirty,
  generateProposals,
}) {
  $('backup-import').onchange = async () => {
    try {
      const file = $('backup-import').files[0];
      if (!file) return;
      if (file.size > 32 * 1024 * 1024) throw new Error('备份不能超过 32 MiB。');
      if (isBusy() || isDirty()) throw new Error('请先完成当前操作并保存规格。');
      const project = await api('/api/projects/import-backup', {
        method: 'POST',
        body: await file.text(),
      });
      show(project);
      await refresh();
      feedback('项目与素材、历史、工程和产物已导入为新项目。构建前请重新确认规格并生成工程。');
    } catch (e) {
      feedback(e.message, true);
    } finally {
      $('backup-import').value = '';
    }
  };
  $('proposal-button').onclick = generateProposals;
  $('project-search').oninput = () => void refresh();
  $('show-archived').onchange = () => void refresh();
  async function metadata(input) {
    const p = getProject();
    if (!p || isBusy() || isDirty()) return feedback('请先保存规格修改并等待当前操作完成。', true);
    try {
      show(
        await api('/api/projects/' + p.id, {
          method: 'PATCH',
          body: JSON.stringify({ revision: p.revision, ...input }),
        }),
      );
      await refresh();
    } catch (e) {
      feedback(e.message, true);
    }
  }
  $('rename-project').onclick = () => void metadata({ name: $('rename-value').value });
  $('archive-project').onclick = () => void metadata({ archived: !getProject()?.archived });
  document.addEventListener('project-shown', ({ detail: p }) => {
    $('backup-export').href = '/api/projects/' + p.id + '/backup';
    $('rename-value').value = p.name;
    $('archive-project').textContent = p.archived ? '恢复到项目列表' : '归档项目';
    $('conversation-list').replaceChildren(
      ...(p.conversation ?? []).map((entry) => {
        const article = node('article', '');
        article.className = 'conversation-entry';
        article.append(
          node(
            'small',
            new Date(entry.at).toLocaleString() +
              ' · 版本 ' +
              entry.revision +
              ' · ' +
              (entry.source?.demo ? '离线示例' : (entry.source?.model ?? '手动')),
          ),
          node('p', '你：' + entry.instruction),
          node('p', '工坊：' + entry.reply),
        );
        return article;
      }),
    );
    if (!p.conversation?.length)
      $('conversation-list').append(
        node('p', '生成规格和后续修改会保留需求、结果摘要及对应版本。'),
      );
    $('proposals-list').replaceChildren(
      ...(p.proposals?.options ?? []).map((proposal) => {
        const card = node('article', '');
        card.className = 'card';
        card.append(
          node('strong', proposal.title),
          node(
            'small',
            (p.proposals.source.demo ? '离线固定样例' : '模型方案') +
              ' · 基于版本 ' +
              p.proposals.basedOnRevision,
          ),
          node('p', proposal.summary),
          node('p', '玩法：' + proposal.gameplay.join('；')),
          node('p', '美术：' + proposal.artDirection),
          node('p', '验收：' + proposal.acceptance.join('；')),
        );
        const button = node('button', '采用为下一次修改要求');
        button.className = 'secondary';
        button.onclick = () => {
          $('revision-instruction').value = proposal.instruction;
          $('revision-instruction').scrollIntoView({ block: 'center' });
          feedback('方案已填入修改要求。可编辑后生成规格；此操作不调用模型。');
        };
        card.append(button);
        return card;
      }),
    );
  });
}
