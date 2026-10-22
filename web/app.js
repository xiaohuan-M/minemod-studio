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
    status.textContent = project.status === 'planned' ? '已有演示计划 · 未构建' : '已记录想法';
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
