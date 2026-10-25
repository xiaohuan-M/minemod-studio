import { initProjectHub } from './studio/project-hub.js';
import { initProviderSettings } from './studio/provider-settings.js';
import { initWorkshop } from './workshop.js';
const $ = (id) => document.getElementById(id);
let selected = null;
let busy = false;
let dirty = false;
let llm = null;
let activeFetch = null;
let historyRequest = 0;
let historyPreviewRequest = 0;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal ?? AbortSignal.timeout(10000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? '请求失败');
  return value;
}
function feedback(message, error = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('error', error);
}
function canReplace() {
  return !dirty || window.confirm('有未保存的规格修改，是否放弃这些修改？');
}
function actions() {
  for (const name of [
    'create-button',
    'plan-button',
    'provider-select',
    'model-consent',
    'spec-editor',
  ])
    $(name).disabled = busy;
  const cloud = $('provider-select').value === 'openai-compatible';
  $('spec-button').disabled = busy || (cloud && (!llm?.configured || !$('model-consent').checked));
  $('spec-button').textContent = cloud ? '使用我的模型生成规格' : '生成离线规格示例';
  $('save-spec').disabled = busy || !dirty;
  $('confirm-spec').disabled = busy || dirty || !selected?.spec || !!selected?.confirmedSpecHash;
  $('test-model').disabled = busy || !llm?.configured || !$('model-consent').checked;
  $('cancel-model').hidden = !activeFetch;
}
function show(project) {
  selected = project;
  dirty = false;
  $('detail').hidden = false;
  $('project-title').textContent = project.name;
  $('project-prompt').textContent = project.prompt;
  $('plan').hidden = !project.plan;
  if (project.plan) {
    $('plan-summary').textContent = project.plan.summary;
    $('steps').replaceChildren(
      ...project.plan.steps.map((step) => {
        const li = document.createElement('li');
        li.textContent = step.title;
        return li;
      }),
    );
    $('assumptions').replaceChildren(
      ...project.plan.assumptions.map((value) => {
        const li = document.createElement('li');
        li.textContent = value;
        return li;
      }),
    );
  }
  $('spec-panel').hidden = !project.spec;
  if (project.spec) {
    $('spec-editor').value = JSON.stringify(project.spec, null, 2);
    const source = project.specSource;
    const label =
      (source?.restoredFromRevision !== undefined
        ? '从版本 ' + source.restoredFromRevision + ' 恢复 · '
        : '') +
      (source?.demo
        ? '离线固定示例'
        : source?.provider === 'openai-compatible'
          ? 'LLM 生成 · ' + source.model
          : '手动编辑规格');
    const usage = source?.usage;
    const tokens = usage
      ? ' · 输入/输出 token：' +
        (usage.inputTokens ?? '未知') +
        '/' +
        (usage.outputTokens ?? '未知')
      : '';
    $('spec-state').textContent =
      label + ' · ' + (project.confirmedSpecHash ? '已确认' : '待审查') + tokens;
    $('export-spec').href = '/api/projects/' + project.id + '/spec/export';
    const entries = project.spec.items.map(
      (item) =>
        item.displayName.zh_cn +
        ' / ' +
        item.displayName.en_us +
        ' · ' +
        item.id +
        ' · 堆叠 ' +
        item.maxStackSize,
    );
    entries.push(
      ...project.spec.recipes.map(
        (recipe) =>
          '配方 ' +
          recipe.id +
          ' · ' +
          (recipe.type === 'crafting_shaped' ? '有序' : '无序') +
          ' → ' +
          recipe.result.item +
          ' × ' +
          recipe.result.count,
      ),
    );
    entries.push(...project.spec.assumptions.map((text) => '待核对：' + text));
    $('spec-preview').replaceChildren(
      ...entries.map((text) => {
        const p = document.createElement('p');
        p.textContent = text;
        return p;
      }),
    );
  }
  actions();
  void refreshHistory(project.id);
  document.dispatchEvent(new CustomEvent('project-shown', { detail: project }));
}
async function refresh() {
  const result = await api('/api/projects');
  const query = $('project-search').value.trim().toLowerCase();
  const projects = result.projects.filter(
    (p) =>
      ($('show-archived').checked || !p.archived) &&
      (p.name + ' ' + p.prompt).toLowerCase().includes(query),
  );
  $('empty').hidden = projects.length > 0;
  $('projects').replaceChildren(
    ...projects.map((project) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = project.name;
      const status = document.createElement('small');
      status.textContent =
        {
          draft: '已记录想法',
          planned: '已有演示计划',
          awaiting_review: '规格待确认',
          spec_confirmed: '规格已确认',
          generated: '工程已生成',
          approved: '工程已批准',
        }[project.status] ?? project.status;
      button.append(status);
      button.addEventListener('click', async () => {
        if (busy || !canReplace()) return;
        busy = true;
        actions();
        try {
          show(await api('/api/projects/' + project.id));
          $('model-consent').checked = false;
        } catch (error) {
          feedback(error.message, true);
        } finally {
          busy = false;
          actions();
        }
      });
      li.append(button);
      return li;
    }),
  );
}
$('create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !canReplace()) return;
  busy = true;
  actions();
  try {
    const project = await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: $('name').value,
        prompt: $('prompt').value,
        targetId: $('target-select').value,
      }),
    });
    show(project);
    $('create-form').reset();
    $('model-consent').checked = false;
    await refresh();
    feedback('项目已保存。数据保存在运行此服务的电脑上。');
  } catch (error) {
    feedback(error.message, true);
  } finally {
    busy = false;
    actions();
  }
});

async function updateProject(path, method, payload, message, model = false) {
  if (!selected || busy) return;
  const id = selected.id;
  busy = true;
  if (model) activeFetch = new AbortController();
  actions();
  if (model) feedback('正在请求选定模型，可取消；原规格会保留至新结果校验成功。');
  try {
    const project = await api('/api/projects/' + id + path, {
      method,
      body: JSON.stringify(payload),
      signal: activeFetch?.signal,
    });
    show(project);
    await refresh();
    feedback(message);
  } catch (error) {
    feedback(
      error.name === 'AbortError'
        ? '请求已停止。请查看项目当前状态；服务商可能仍会计费。'
        : error.message,
      true,
    );
    if (model) {
      try {
        show(await api('/api/projects/' + id));
      } catch {
        /* Keep the visible last saved state. */
      }
    }
  } finally {
    busy = false;
    activeFetch = null;
    if (model) $('model-consent').checked = false;
    actions();
  }
}
$('plan-button').addEventListener('click', () => {
  if (canReplace())
    void updateProject('/plan', 'POST', {}, '已保存离线演示计划。尚未生成代码或执行构建。');
});
$('spec-button').addEventListener('click', () => {
  if (!selected || busy || !canReplace()) return;
  if (
    selected.spec &&
    !window.confirm(
      '新结果通过校验后将替换当前规格并清除确认。旧规格会保留到历史中（最近 20 个版本）。继续吗？',
    )
  )
    return;
  const provider = $('provider-select').value;
  const model = provider === 'openai-compatible';
  if (model && (!llm?.configured || !$('model-consent').checked)) return;
  void updateProject(
    '/spec/generate',
    'POST',
    {
      provider,
      revision: selected.revision,
      ...(model && $('revision-instruction').value.trim()
        ? { instruction: $('revision-instruction').value.trim() }
        : {}),
      ...(model && $('repair-build').value ? { repairBuildId: $('repair-build').value } : {}),
      ...(model ? { consent: llm.configurationId } : {}),
    },
    model
      ? '模型规格已通过校验并保存。请审查假设和配方，再确认。'
      : '离线示例已保存。请核对物品、配方和假设后确认。',
    model,
  );
});
$('save-spec').addEventListener('click', () => {
  if (!selected) return;
  try {
    void updateProject(
      '/spec',
      'PUT',
      { spec: JSON.parse($('spec-editor').value), revision: selected.revision },
      '规格已校验并保存，之前的确认已失效。',
    );
  } catch {
    feedback('JSON 格式不正确，请检查引号和逗号。', true);
  }
});
$('confirm-spec').addEventListener('click', () => {
  if (selected && !dirty)
    void updateProject(
      '/spec/confirm',
      'POST',
      { revision: selected.revision },
      '当前规格已确认，可以在工程面板生成源码。',
    );
});
$('spec-editor').addEventListener('input', () => {
  dirty = $('spec-editor').value !== JSON.stringify(selected?.spec, null, 2);
  actions();
  feedback(dirty ? '有未保存的修改，请先校验并保存。' : '当前显示已保存的规格。');
});
$('provider-select').addEventListener('change', () => {
  $('model-details').hidden = $('provider-select').value !== 'openai-compatible';
  $('model-consent').checked = false;
  actions();
});
$('model-consent').addEventListener('change', actions);
$('test-model').addEventListener('click', async () => {
  if (busy || !llm?.configured || !$('model-consent').checked) return;
  busy = true;
  activeFetch = new AbortController();
  actions();
  feedback('正在发送固定测试样例，验证模型返回的规格。');
  try {
    await api('/api/providers/openai-compatible/test', {
      method: 'POST',
      body: JSON.stringify({ consent: llm.configurationId }),
      signal: activeFetch.signal,
    });
    feedback('连接验证通过：该接口返回了合法规格。实际玩法质量仍需审查。');
  } catch (error) {
    feedback(
      error.name === 'AbortError' ? '已停止连接测试；服务商可能仍会计费。' : error.message,
      true,
    );
  } finally {
    busy = false;
    activeFetch = null;
    $('model-consent').checked = false;
    actions();
  }
});
$('cancel-model').addEventListener('click', () => {
  activeFetch?.abort();
});
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function refreshProviderState() {
  const { providers } = await api('/api/providers');
  llm = providers.find((provider) => provider.id === 'openai-compatible');
  $('provider-info').textContent = llm?.configured
    ? '目标：' + llm.baseUrl + '\n模型：' + llm.model + '\n超时：' + llm.timeoutMs / 1000 + ' 秒'
    : (llm?.configurationError ?? '尚未配置自定义模型，请在页面上方模型设置中保存并启用服务。');
  $('model-consent').checked = false;
  $('ai-asset-consent').checked = false;
  actions();
}
async function initialize() {
  await refreshProviderState();
  await refresh();
  actions();
}
initialize().catch((error) => feedback('初始化失败：' + error.message, true));
document.addEventListener('providers-changed', () => {
  void refreshProviderState().catch((error) => feedback(error.message, true));
});
initProviderSettings({ api });

async function refreshHistory(id) {
  const requestId = ++historyRequest;
  $('history-preview').hidden = true;
  $('history-list').replaceChildren();
  if (!selected?.spec) return;
  try {
    const { history } = await api('/api/projects/' + id + '/spec/history');
    if (selected?.id !== id || requestId !== historyRequest) return;
    if (!history.length) {
      const li = document.createElement('li');
      li.textContent = '尚无历史版本；下一次修改时会保留当前规格。';
      $('history-list').append(li);
    }
    for (const entry of history) {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.textContent =
        '版本 ' +
        entry.revision +
        ' · ' +
        entry.displayName +
        ' · ' +
        entry.itemCount +
        ' 个物品 / ' +
        entry.recipeCount +
        ' 个配方 · ' +
        (entry.confirmed ? '当时已确认' : '当时未确认') +
        ' · ' +
        new Date(entry.savedAt).toLocaleString();
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'secondary';
      view.textContent = '查看版本 ' + entry.revision;
      view.addEventListener('click', async () => {
        if (busy) return;
        const previewRequest = ++historyPreviewRequest;
        $('history-preview').hidden = true;
        try {
          const snapshot = await api('/api/projects/' + id + '/spec/history/' + entry.revision);
          if (
            selected?.id !== id ||
            requestId !== historyRequest ||
            previewRequest !== historyPreviewRequest
          )
            return;
          $('history-preview').textContent = JSON.stringify(snapshot.spec, null, 2);
          $('history-preview').hidden = false;
        } catch (error) {
          feedback(error.message, true);
        }
      });
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'secondary';
      restore.textContent = '恢复版本 ' + entry.revision;
      restore.addEventListener('click', () => {
        if (busy || selected?.id !== id || !canReplace()) return;
        if (
          !window.confirm(
            '恢复为版本 ' + entry.revision + '？当前规格将保留到历史中，恢复后需要重新确认。',
          )
        )
          return;
        void updateProject(
          '/spec/restore',
          'POST',
          { fromRevision: entry.revision, revision: selected.revision },
          '历史规格已恢复；请重新审查并确认。',
        );
      });
      li.append(text, view, restore);
      $('history-list').append(li);
    }
  } catch (error) {
    if (selected?.id === id && requestId === historyRequest)
      feedback('历史读取失败：' + error.message, true);
  }
}

initWorkshop({
  api,
  getProvider: () => llm,
  getProject: () => selected,
  isDirty: () => dirty,
  isBusy: () => busy,
  show,
  refresh,
  feedback,
});

api('/api/targets')
  .then(({ targets }) => {
    const labels = {
      compiled: '真实编译通过，未游戏实测',
      'package-checked': '包结构验证，未游戏实测',
      unverified: '尚未验证',
    };
    $('target-select').replaceChildren(
      ...targets
        .filter((t) => t.enabled)
        .map((t) => {
          const option = document.createElement('option');
          option.value = t.id;
          option.textContent = t.label;
          return option;
        }),
    );
    $('target-select').value = 'fabric-1.21.1';
    const describe = () => {
      const target = targets.find((t) => t.id === $('target-select').value);
      const featureLabels = {
        items: '物品',
        food: '食物',
        tools: '工具',
        lightning_wand: '法杖',
        blocks: '方块',
        recipes: '配方',
        custom_loot: '自定义掉落',
        textures: '贴图',
        static_models: '静态模型',
        vanilla_entity_archetypes: '实体原型',
        entities: '实体',
        cube_animation: '立方体动画',
      };
      $('target-features').textContent =
        labels[target.validation] +
        ' · ' +
        target.features
          .map((feature) => featureLabels[feature])
          .filter(Boolean)
          .join('、');
    };
    $('target-select').onchange = describe;
    describe();
  })
  .catch((error) => feedback(error.message, true));

initProjectHub({
  api,
  getProject: () => selected,
  show,
  refresh,
  feedback,
  isBusy: () => busy,
  isDirty: () => dirty,
  generateProposals: () => {
    if (!selected || busy || !canReplace()) return;
    const provider = $('provider-select').value,
      cloud = provider === 'openai-compatible';
    if (cloud && (!llm?.configured || !$('model-consent').checked))
      return feedback('请先选择有效模型并确认本次调用。', true);
    void updateProject(
      '/proposals',
      'POST',
      { revision: selected.revision, provider, ...(cloud ? { consent: llm.configurationId } : {}) },
      '方案已保存。采用方案后可继续编辑修改要求，再生成规格。',
      cloud,
    );
  },
});
