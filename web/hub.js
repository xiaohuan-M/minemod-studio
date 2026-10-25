const $ = (id) => document.getElementById(id);
let platform,
  accountData,
  offset = 0,
  marketQuery = { q: '', filter: 'public' };
async function api(path, method = 'GET', data) {
  const r = await fetch(path, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : {},
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error?.message ?? '请求失败');
  return result;
}
function notice(message) {
  $('notice').textContent = message;
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function action(label, fn) {
  const button = el('button', label);
  button.type = 'button';
  button.addEventListener('click', () => run(button, fn));
  return button;
}
async function run(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (error) {
    notice(error.message);
  } finally {
    button.disabled = false;
  }
}
function form(id, fn) {
  $(id).addEventListener('submit', (e) => {
    e.preventDefault();
    run(e.submitter, () => fn(Object.fromEntries(new FormData(e.target)), e.target));
  });
}
async function refresh() {
  platform = await api('/api/platform');
  if (platform.mode !== 'hosted') {
    notice('此页面用于可选托管服务。本地创作台无需登录。');
    return;
  }
  const logged = platform.authenticated;
  $('login-panel').hidden = logged;
  $('account-panel').hidden = !logged;
  $('publish-panel').hidden = !logged;
  $('wechat').hidden = !platform.wechatConfigured;
  if (logged) {
    accountData = await api('/api/hub/account');
    const user = accountData.account;
    $('greeting').textContent = user.displayName + ' 的工作室';
    $('balance').textContent = '当前余额 ' + user.credits + ' 积分';
    $('admin').hidden = user.role !== 'admin';
    $('route').replaceChildren(
      ...platform.routes.map((route) => {
        const o = el('option', route.label + ' · ' + route.model);
        o.value = route.id;
        return o;
      }),
    );
    $('route').value = platform.selectedRoute ?? '';
    $('route').disabled = !platform.routes.length;
    routeInfo();
    const table = el('table'),
      head = el('tr');
    for (const t of ['时间', '变动', '余额', '原因']) head.append(el('th', t));
    table.append(head);
    for (const r of accountData.ledger) {
      const tr = el('tr');
      for (const t of [r.created_at, new Intl.NumberFormat().format(r.delta), r.balance, r.reason])
        tr.append(el('td', t));
      table.append(tr);
    }
    $('ledger').replaceChildren(table);
    $('incentive-list').replaceChildren(
      ...accountData.incentives
        .filter((i) => i.user_id === user.id)
        .map((i) => el('p', i.title + ' · ' + i.status + ' · 奖励 ' + i.reward)),
    );
    if (user.role === 'admin') await reviews();
    const { assets } = await api('/api/assets');
    $('publish-assets').replaceChildren(
      ...assets.map((a) => {
        const o = el('option', a.name + ' · ' + a.kind);
        o.value = a.id;
        return o;
      }),
    );
  }
  await market();
}
function routeInfo() {
  const r = platform.routes.find((r) => r.id === $('route').value);
  $('route-info').textContent = r
    ? `${r.baseUrl} · 输入 ${r.inputCreditsPer1000} / 输出 ${r.outputCreditsPer1000} 积分每千 token${!r.inputCreditsPer1000 && !r.outputCreditsPer1000 ? ' · 公益免费线路' : ''}`
    : '管理员尚未配置托管线路，可在创作台设置自己的 API。';
}
async function reviews() {
  const pending = await api('/api/hub/market?pending=true');
  $('review-market').replaceChildren(
    ...pending.listings.map((item) => {
      const c = card(item);
      c.append(
        action('通过上架', async () => {
          await api(`/api/hub/market/${item.id}/review`, 'POST', {
            revision: item.revision,
            approve: true,
          });
          await refresh();
        }),
        action('拒绝', async () => {
          const reason = prompt('拒绝原因');
          if (reason === null) return;
          await api(`/api/hub/market/${item.id}/review`, 'POST', {
            revision: item.revision,
            approve: false,
            reason,
          });
          await refresh();
        }),
      );
      return c;
    }),
  );
  $('review-incentives').replaceChildren(
    ...accountData.incentives
      .filter((i) => i.status === 'pending')
      .map((item) => {
        const c = el('article');
        c.append(el('p', item.username + ' · ' + item.title));
        const a = el('a', '查看作品');
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        c.append(
          a,
          action('奖励通过', async () => {
            const raw = prompt('奖励积分（0–10000）', '100');
            if (raw === null) return;
            await api(`/api/hub/incentives/${item.id}/review`, 'POST', {
              approve: true,
              reward: Number(raw),
            });
            await refresh();
          }),
          action('拒绝', async () => {
            const reason = prompt('拒绝原因');
            if (reason === null) return;
            await api(`/api/hub/incentives/${item.id}/review`, 'POST', { approve: false, reason });
            await refresh();
          }),
        );
        return c;
      }),
  );
}
function card(item) {
  const c = el('article');
  c.append(
    el('h3', item.title),
    el('p', item.description),
    el(
      'p',
      `${item.username ?? ''} · v${item.revision} · ${item.license} · ${item.status}`,
      'meta',
    ),
    el('p', item.tags.join(' · '), 'meta'),
  );
  const a = el('a', '下载资源包');
  a.href = `/api/hub/market/${item.id}/package`;
  c.append(
    a,
    action('查看模型与来源', () => previewListing(item)),
  );
  return c;
}
async function market(append = false) {
  const p = new URLSearchParams({ q: marketQuery.q, offset: String(offset) });
  if (marketQuery.filter !== 'public') p.set(marketQuery.filter, 'true');
  const { listings } = await api('/api/hub/market?' + p);
  const cards = listings.map((item) => {
    const c = card(item);
    if (platform.authenticated) {
      c.append(
        action('导入我的素材库', async () => {
          await api(`/api/hub/market/${item.id}/import`, 'POST', {});
          notice('已导入，可在创作台选择使用。');
        }),
        action('收藏', async () => {
          await api(`/api/hub/market/${item.id}/favorite`, 'POST', { favorite: true });
          notice('已收藏。');
        }),
        action('取消收藏', async () => {
          await api(`/api/hub/market/${item.id}/favorite`, 'POST', { favorite: false });
          notice('已取消收藏。');
        }),
      );
      if (item.owned)
        c.append(
          action('下架', async () => {
            await api(`/api/hub/market/${item.id}/unpublish`, 'POST', {});
            await market();
          }),
          action('提交更新', async () => {
            const title = prompt('新标题', item.title);
            if (!title) return;
            const description = prompt('新说明', item.description);
            if (!description) return;
            const { payload } = await api(`/api/hub/market/${item.id}/package`).then((payload) => ({
              payload,
            }));
            await api('/api/hub/market', 'POST', {
              id: item.id,
              revision: item.current_revision,
              title,
              description,
              tags: item.tags,
              license: item.license,
              rightsConfirmed: true,
              package: payload,
            });
            notice('修改已提交审核。');
            await refresh();
          }),
        );
    }
    return c;
  });
  if (append) $('market').append(...cards);
  else
    $('market').replaceChildren(...(cards.length ? cards : [el('p', '暂无符合条件的公开资源。')]));
  $('more').hidden = listings.length < 50;
}
form('login', async (input) => {
  await api('/api/hub/login', 'POST', input);
  location.href = '/';
});
form('register', async (input) => {
  if (!input.displayName) delete input.displayName;
  await api('/api/hub/register', 'POST', input);
  location.href = '/';
});
$('logout').onclick = () =>
  run($('logout'), async () => {
    await api('/api/hub/logout', 'POST', {});
    location.href = '/hub';
  });
$('checkin').onclick = () =>
  run($('checkin'), async () => {
    const r = await api('/api/hub/checkin', 'POST', {});
    notice(r.alreadyChecked ? '今天已经签到。' : '签到成功，+10 积分。');
    await refresh();
  });
$('route').onchange = () =>
  run($('route'), async () => {
    await api('/api/hub/route', 'POST', { routeId: $('route').value });
    routeInfo();
    notice('线路已切换。');
  });
form('incentive', async (input, form) => {
  await api('/api/hub/incentives', 'POST', input);
  form.reset();
  notice('投稿已提交审核。');
  await refresh();
});
form('password', async (input, form) => {
  await api('/api/hub/password', 'POST', input);
  form.reset();
  notice('密码已更新，旧会话和 API 令牌已撤销。');
});
form('token', async (input) => {
  const r = await api('/api/hub/tokens', 'POST', input);
  $('token-result').textContent =
    '仅显示一次，请安全保存：' +
    r.token +
    '。接口基址：' +
    location.origin +
    '/api/hub/llm/' +
    (platform.selectedRoute ?? '线路ID') +
    '/v1';
});
form('revoke-token', async (input, form) => {
  await api('/api/hub/tokens', 'DELETE', input);
  form.reset();
  notice('令牌已撤销。');
});
$('invite').onclick = () =>
  run($('invite'), async () => {
    const r = await api('/api/hub/invites', 'POST', {});
    $('invite-result').textContent = '一次性邀请码（7 天有效）：' + r.invite;
  });
form('search', async (input) => {
  marketQuery = input;
  offset = 0;
  await market();
});
$('more').onclick = () =>
  run($('more'), async () => {
    offset += 50;
    await market(true);
  });
form('publish', async (input, form) => {
  const file = $('package-file').files[0];
  const request = {
    ...input,
    tags: input.tags
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean),
    rightsConfirmed: input.rightsConfirmed === 'on',
  };
  delete request.assetIds;
  if (file) {
    if (file.size > 32 * 1024 * 1024) throw new Error('资源包超过 32 MiB');
    request.package = JSON.parse(await file.text());
  } else request.assetIds = [...$('publish-assets').selectedOptions].map((o) => o.value);
  await api('/api/hub/market', 'POST', request);
  form.reset();
  notice('已提交上架审核。');
  await refresh();
});
$('wechat').onclick = () =>
  run($('wechat'), async () => {
    const invite = document.querySelector('#register input[name=invite]').value;
    const r = await api('/api/hub/wechat/start?' + new URLSearchParams({ invite }));
    location.href = r.url;
  });
refresh().catch((error) => notice(error.message));

let marketPreview, previewPack;
async function previewListing(item) {
  previewPack = await api('/api/hub/market/' + item.id + '/package');
  $('preview-title').textContent = item.title;
  $('preview-assets').replaceChildren(
    ...previewPack.assets.map((a, i) => {
      const o = el('option', a.name + ' · ' + a.kind);
      o.value = String(i);
      return o;
    }),
  );
  $('preview-dialog').showModal();
  await displayPreview();
}
async function displayPreview() {
  const asset = previewPack.assets[Number($('preview-assets').value)];
  $('preview-attribution').textContent = '来源：' + asset.source + '\n许可：' + asset.license;
  const isModel = ['model', 'animated_model'].includes(asset.kind);
  $('market-canvas').hidden = !isModel;
  if (isModel) {
    if (!marketPreview) {
      const { modelPreview } = await import('/model-preview.js');
      marketPreview = modelPreview($('market-canvas'));
    }
    marketPreview.set(asset.data);
    marketPreview.texture(asset.data.texture ?? null);
    marketPreview.view('orbit');
  }
}
$('preview-assets').onchange = () => displayPreview().catch((e) => notice(e.message));
$('preview-close').onclick = () => $('preview-dialog').close();
