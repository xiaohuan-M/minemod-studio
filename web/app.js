const $ = (id) => document.getElementById(id);
let selected = null;
let planning = false;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? '请求失败');
  return value;
}

function feedback(message, error = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('error', error);
}

function show(project) {
  selected = project;
  $('detail').hidden = false;
  $('project-title').textContent = project.name;
  $('project-prompt').textContent = project.prompt;
  $('plan').hidden = !project.plan;
  $('plan-button').disabled = planning;
  showSpec(project);
  if (project.plan) {
    $('plan-summary').textContent = project.plan.summary;
    $('steps').replaceChildren(...project.plan.steps.map((step) => {
      const li = document.createElement('li');
      li.textContent = step.title;
      return li;
    }));
    $('assumptions').replaceChildren(...project.plan.assumptions.map((value) => {
      const li = document.createElement('li');
      li.textContent = value;
      return li;
    }));
  }
}

async function refresh() {
  const { projects } = await api('/api/projects');
  $('empty').hidden = projects.length > 0;
  $('projects').replaceChildren(...projects.map((project) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = project.name;
    const status = document.createElement('small');
    status.textContent = ({draft:'已记录想法',planned:'已有演示计划',awaiting_review:'规格待确认',spec_confirmed:'规格已确认'})[project.status] + ' · 未构建';
    button.append(status);
    button.addEventListener('click', () => { if (!planning) show(project); });
    li.append(button);
    return li;
  }));
}

$('create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('create-button').disabled = true;
  try {
    const project = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: $('name').value, prompt: $('prompt').value }) });
    show(project);
    $('create-form').reset();
    await refresh();
    feedback('项目已保存。数据保存在运行此服务的电脑上。');
  } catch (error) { feedback(error.message, true); }
  finally { $('create-button').disabled = false; }
});

$('plan-button').addEventListener('click', async () => {
  if (!selected || planning) return;
  const id = selected.id;
  planning = true;
  $('plan-button').disabled = true;
  try {
    const project = await api(`/api/projects/${id}/plan`, { method: 'POST', body: '{}' });
    if (selected?.id === id) show(project);
    await refresh();
    feedback('已保存离线演示计划。尚未生成代码或执行构建。');
  } catch (error) { feedback(error.message, true); }
  finally { planning = false; $('plan-button').disabled = false; }
});

refresh().catch((error) => feedback(`无法读取项目：${error.message}`, true));

function showSpec(project) {
  $('spec-panel').hidden = !project.spec;
  if (!project.spec) return;
  $('spec-editor').value = JSON.stringify(project.spec, null, 2);
  $('confirm-spec').disabled = !!project.confirmedSpecHash;
  $('spec-state').textContent = (project.specSource?.demo ? '离线固定示例' : '手动编辑规格') + ' · ' + (project.confirmedSpecHash ? '已确认' : '待审查') + ' · 未构建';
  $('export-spec').href = '/api/projects/' + project.id + '/spec/export';
  const entries = project.spec.items.map(item => item.displayName.zh_cn + ' / ' + item.displayName.en_us + ' · ' + item.id + ' · 堆叠 ' + item.maxStackSize);
  entries.push(...project.spec.recipes.map(recipe => '配方 ' + recipe.id + ' · ' + (recipe.type === 'crafting_shaped' ? '有序' : '无序') + ' → ' + recipe.result.item + ' × ' + recipe.result.count));
  entries.push(...project.spec.assumptions.map(text => '待核对：' + text));
  $('spec-preview').replaceChildren(...entries.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
}

async function updateSpec(path, method, payload, message) {
  if (!selected || planning) return;
  const id = selected.id;
  planning = true;
  for (const name of ['spec-button', 'save-spec', 'confirm-spec', 'plan-button', 'create-button']) $(name).disabled = true;
  try {
    const project = await api('/api/projects/' + id + path, {method,body:JSON.stringify({...payload,revision:selected.revision})});
    if (selected?.id === id) show(project);
    await refresh();
    feedback(message);
  } catch (error) { feedback(error.message, true); }
  finally {
    planning = false;
    for (const name of ['spec-button', 'save-spec', 'plan-button', 'create-button']) $(name).disabled = false;
    $('confirm-spec').disabled = !!selected?.confirmedSpecHash || $('spec-editor').value !== JSON.stringify(selected?.spec, null, 2);
  }
}
$('spec-button').addEventListener('click', () => updateSpec('/spec/generate', 'POST', {provider:'mock'}, '离线示例已保存。请核对物品、配方和假设后确认。'));
$('save-spec').addEventListener('click', () => {
  try { void updateSpec('/spec', 'PUT', {spec:JSON.parse($('spec-editor').value)}, '规格已校验并保存，之前的确认已失效。'); }
  catch { feedback('JSON 格式不正确，请检查引号和逗号。', true); }
});
$('confirm-spec').addEventListener('click', () => updateSpec('/spec/confirm', 'POST', {}, '当前规格已确认。尚未生成代码或执行构建。'));
$('spec-editor').addEventListener('input', () => {
  $('confirm-spec').disabled = true;
  feedback('有未保存的修改，请先校验并保存。');
});
