import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from '../core/errors.mjs';

const derive = promisify(scrypt),
  now = () => new Date().toISOString();
export const tokenHash = (value) => createHash('sha256').update(value).digest('hex');
const invalid = (message) => {
  throw new AppError(422, 'INVALID_INPUT', message);
};
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    invalid(label + '不能为空或超过 ' + max + ' 字。');
  return value.trim();
};
const username = (value) => {
  const s = text(value, 40, '账号').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(s))
    invalid('账号为 3–40 位字母、数字、点、横线或下划线。');
  return s;
};
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200)
    invalid('密码需要 10–200 个字符。');
  const salt = randomBytes(16);
  const key = await derive(password, salt, 64);
  return salt.toString('hex') + ':' + key.toString('hex');
}
async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const [salt, expected] = (stored ?? '00000000000000000000000000000000:' + '0'.repeat(128)).split(
    ':',
  );
  const key = await derive(password, Buffer.from(salt, 'hex'), 64);
  return !!stored && timingSafeEqual(Buffer.from(expected, 'hex'), key);
}
export function publicAccount(row) {
  return row
    ? {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        credits: row.credits,
        createdAt: row.created_at,
        wechatLinked: !!row.wechat_openid,
      }
    : null;
}

/** Transactional hosted metadata. Local workspaces stay in independent, per-account repositories. */
export class HubStore {
  constructor(dataDir) {
    this.root = resolve(dataDir);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const file = join(this.root, 'hub.sqlite');
    this.db = new DatabaseSync(file);
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) {
      this.db.close();
      throw new AppError(
        409,
        'HUB_DATABASE_VERSION',
        '数据库版本较新，请使用匹配的应用版本，不要覆盖数据库。',
      );
    }
    try {
      chmodSync(file, 0o600);
    } catch {
      /* Windows uses the private directory ACL. */
    }
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,password_hash TEXT,wechat_openid TEXT UNIQUE,role TEXT NOT NULL CHECK(role IN ('admin','member')),credits INTEGER NOT NULL CHECK(credits>=0),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,label TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
      CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,created_by TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,uses_left INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),delta INTEGER NOT NULL,balance INTEGER NOT NULL,reason TEXT NOT NULL,reference TEXT UNIQUE NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id,created_at);
      CREATE TABLE IF NOT EXISTS preferences(user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(user_id,name));
      CREATE TABLE IF NOT EXISTS incentives(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),url TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,review_reason TEXT,reward INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,UNIQUE(user_id,url));
      CREATE TABLE IF NOT EXISTS listings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),current_revision INTEGER NOT NULL,published_revision INTEGER,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS listing_revisions(listing_id TEXT NOT NULL REFERENCES listings(id),revision INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL,license TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,checksum TEXT NOT NULL,review_reason TEXT,created_at TEXT NOT NULL,PRIMARY KEY(listing_id,revision));
      CREATE TABLE IF NOT EXISTS listing_events(id TEXT PRIMARY KEY,listing_id TEXT NOT NULL,user_id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS favorites(user_id TEXT NOT NULL REFERENCES users(id),listing_id TEXT NOT NULL REFERENCES listings(id),PRIMARY KEY(user_id,listing_id));
      CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),route_id TEXT NOT NULL,reserved INTEGER NOT NULL,status TEXT NOT NULL,billed INTEGER,usage TEXT,created_at TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
    this.db
      .prepare("DELETE FROM tokens WHERE kind='workspace-model' OR expires_at<=?")
      .run(Date.now());
    this.tx(() => {
      for (const r of this.db.prepare("SELECT * FROM reservations WHERE status='pending'").all()) {
        if (r.reserved)
          this.adjust(r.user_id, r.reserved, 'interrupted-refund', 'refund:' + r.id, {
            routeId: r.route_id,
          });
        this.db.prepare("UPDATE reservations SET status='interrupted' WHERE id=?").run(r.id);
      }
    });
  }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  user(id) {
    const row = this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!row) throw new AppError(404, 'ACCOUNT_NOT_FOUND', '账号不存在。');
    return row;
  }
  account(id) {
    return publicAccount(this.user(id));
  }
  adjust(id, delta, reason, reference, details = {}) {
    if (!Number.isSafeInteger(delta)) invalid('积分变更无效。');
    const balance = this.user(id).credits + delta;
    if (balance < 0 || balance > 1_000_000_000)
      throw new AppError(402, 'INSUFFICIENT_CREDITS', '积分余额不足，或超过余额上限。');
    this.db.prepare('UPDATE users SET credits=? WHERE id=?').run(balance, id);
    this.db
      .prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), id, delta, balance, reason, reference, JSON.stringify(details), now());
    return balance;
  }
  async bootstrap(name, password) {
    if (this.db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()) return;
    if (!name || !password)
      throw new AppError(
        409,
        'HUB_SETUP',
        '首次启动需要 MINEMOD_HUB_ADMIN_USERNAME 和 MINEMOD_HUB_ADMIN_PASSWORD。',
      );
    const login = username(name),
      hash = await passwordHash(password),
      id = randomUUID();
    this.tx(() => {
      this.db
        .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
        .run(id, login, login, hash, null, 'admin', 0, now());
      this.adjust(id, 1000, 'signup-gift', 'signup:' + id);
    });
  }
  async register(input, { allowRegistration = false } = {}) {
    const login = username(input.username),
      displayName = text(input.displayName ?? login, 80, '显示名称'),
      hash = await passwordHash(input.password),
      id = randomUUID();
    if (this.db.prepare('SELECT id FROM users WHERE username=?').get(login))
      throw new AppError(409, 'ACCOUNT_EXISTS', '账号已存在。');
    this.tx(() => {
      if (!allowRegistration) {
        const invite =
          typeof input.invite === 'string'
            ? this.db.prepare('SELECT * FROM invites WHERE hash=?').get(tokenHash(input.invite))
            : null;
        if (!invite || invite.uses_left < 1 || invite.expires_at < Date.now())
          throw new AppError(403, 'INVITE_REQUIRED', '请输入管理员提供的有效邀请码。');
        this.db.prepare('UPDATE invites SET uses_left=uses_left-1 WHERE hash=?').run(invite.hash);
      }
      this.db
        .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
        .run(id, login, displayName, hash, null, 'member', 0, now());
      this.adjust(id, 1000, 'signup-gift', 'signup:' + id);
    });
    return this.account(id);
  }
  async login(name, password) {
    const login = username(name),
      row = this.db.prepare('SELECT * FROM users WHERE username=?').get(login);
    if (!(await passwordMatches(password, row?.password_hash)))
      throw new AppError(401, 'LOGIN_FAILED', '账号或密码不正确。');
    return publicAccount(row);
  }
  async changePassword(id, oldPassword, newPassword) {
    const row = this.user(id);
    if (!(await passwordMatches(oldPassword, row.password_hash)))
      throw new AppError(401, 'LOGIN_FAILED', '原密码不正确。');
    const hash = await passwordHash(newPassword);
    this.tx(() => {
      this.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, id);
      this.db.prepare('DELETE FROM tokens WHERE user_id=?').run(id);
    });
  }
  token(id, kind = 'session', label = '浏览器会话', ttl = 7 * 86400000) {
    this.user(id);
    this.db.prepare('DELETE FROM tokens WHERE expires_at<=?').run(Date.now());
    const count = this.db
      .prepare('SELECT COUNT(*) AS count FROM tokens WHERE user_id=? AND kind=?')
      .get(id, kind).count;
    if (count >= (kind === 'model' ? 20 : 50))
      throw new AppError(
        409,
        'TOKEN_LIMIT',
        '有效令牌或会话达到上限，请撤销旧令牌或等待会话到期。',
      );
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?)')
      .run(tokenHash(token), id, kind, label, Date.now() + ttl, now());
    return token;
  }
  authenticate(token, kinds = ['session']) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const t = this.db
      .prepare('SELECT * FROM tokens WHERE hash=? AND expires_at>?')
      .get(tokenHash(token), Date.now());
    return t && kinds.includes(t.kind) ? this.account(t.user_id) : null;
  }
  revoke(token) {
    if (typeof token === 'string')
      this.db.prepare('DELETE FROM tokens WHERE hash=?').run(tokenHash(token));
  }
  invite(adminId) {
    if (this.user(adminId).role !== 'admin')
      throw new AppError(403, 'ADMIN_REQUIRED', '需要管理员。');
    const token = randomBytes(24).toString('base64url');
    this.db
      .prepare('INSERT INTO invites VALUES(?,?,?,?)')
      .run(tokenHash(token), adminId, Date.now() + 7 * 86400000, 1);
    return token;
  }
  preference(id, name, value) {
    this.user(id);
    if (value === undefined)
      return (
        this.db.prepare('SELECT value FROM preferences WHERE user_id=? AND name=?').get(id, name)
          ?.value ?? null
      );
    this.db
      .prepare(
        'INSERT INTO preferences VALUES(?,?,?) ON CONFLICT(user_id,name) DO UPDATE SET value=excluded.value',
      )
      .run(id, name, String(value));
  }
  checkin(id) {
    const day = new Date().toISOString().slice(0, 10),
      reference = 'checkin:' + id + ':' + day;
    return this.tx(() => {
      if (this.db.prepare('SELECT id FROM ledger WHERE reference=?').get(reference))
        return { alreadyChecked: true, account: this.account(id) };
      this.adjust(id, 10, 'daily-checkin', reference, { day });
      return { alreadyChecked: false, account: this.account(id) };
    });
  }
  ledger(id) {
    return this.db
      .prepare(
        'SELECT id,delta,balance,reason,details,created_at FROM ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
      )
      .all(id)
      .map((r) => ({ ...r, details: JSON.parse(r.details) }));
  }
  submitIncentive(id, input) {
    const title = text(input.title, 120, '作品标题');
    let url;
    try {
      url = new URL(input.url);
    } catch {
      invalid('请输入作品链接。');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      ![
        'bilibili.com',
        'www.bilibili.com',
        'b23.tv',
        'www.douyin.com',
        'v.douyin.com',
        'www.xiaohongshu.com',
        'xiaohongshu.com',
        'xhslink.com',
      ].includes(url.hostname)
    )
      invalid('仅接受 B站、抖音、小红书的 HTTPS 作品链接。');
    if (url.href.length > 2048) invalid('链接过长。');
    const record = {
      id: randomUUID(),
      userId: id,
      title,
      url: url.href,
      status: 'pending',
      createdAt: now(),
    };
    if (this.db.prepare('SELECT id FROM incentives WHERE user_id=? AND url=?').get(id, url.href))
      throw new AppError(409, 'ALREADY_SUBMITTED', '已提交这个作品。');
    this.db
      .prepare('INSERT INTO incentives(id,user_id,url,title,status,created_at) VALUES(?,?,?,?,?,?)')
      .run(record.id, id, record.url, title, 'pending', record.createdAt);
    return record;
  }
  incentives(user) {
    return user.role === 'admin'
      ? this.db
          .prepare(
            'SELECT i.*,u.username FROM incentives i JOIN users u ON u.id=i.user_id ORDER BY i.created_at DESC LIMIT 100',
          )
          .all()
      : this.db
          .prepare('SELECT * FROM incentives WHERE user_id=? ORDER BY created_at DESC LIMIT 100')
          .all(user.id);
  }
  reviewIncentive(admin, id, { approve, reward = 100, reason = '' }) {
    if (admin.role !== 'admin') throw new AppError(403, 'ADMIN_REQUIRED', '需要管理员。');
    if (
      typeof approve !== 'boolean' ||
      !Number.isInteger(reward) ||
      reward < 0 ||
      reward > 10000 ||
      typeof reason !== 'string' ||
      reason.length > 500
    )
      invalid('审核参数无效。');
    return this.tx(() => {
      const row = this.db.prepare('SELECT * FROM incentives WHERE id=?').get(id);
      if (!row || row.status !== 'pending')
        throw new AppError(409, 'ALREADY_REVIEWED', '投稿不存在或已审核。');
      if (approve && reward)
        this.adjust(row.user_id, reward, 'creation-incentive', 'incentive:' + id, { url: row.url });
      this.db
        .prepare('UPDATE incentives SET status=?,reward=?,review_reason=? WHERE id=?')
        .run(approve ? 'approved' : 'rejected', approve ? reward : 0, reason, id);
      return { approved: approve, reward: approve ? reward : 0 };
    });
  }
  publish(user, input, payload) {
    const title = text(input.title, 80, '模型标题'),
      description = text(input.description, 2000, '模型说明'),
      license = text(input.license, 80, '许可');
    if (input.rightsConfirmed !== true)
      throw new AppError(400, 'RIGHTS_REQUIRED', '请确认有权分享这些素材。');
    const tags = input.tags ?? [];
    if (
      !Array.isArray(tags) ||
      tags.length > 10 ||
      tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 32)
    )
      invalid('标签最多 10 个，每个 32 字。');
    let id = input.id ?? randomUUID(),
      revision = 1;
    return this.tx(() => {
      if (input.id) {
        const old = this.db.prepare('SELECT * FROM listings WHERE id=?').get(id);
        if (!old || old.user_id !== user.id)
          throw new AppError(403, 'LISTING_OWNER', '只能更新自己的模型。');
        if (input.revision !== old.current_revision)
          throw new AppError(409, 'LISTING_CHANGED', '模型已更新，请刷新。');
        revision = old.current_revision + 1;
        this.db.prepare('UPDATE listings SET current_revision=? WHERE id=?').run(revision, id);
      } else
        this.db.prepare('INSERT INTO listings VALUES(?,?,?,?,?)').run(id, user.id, 1, null, now());
      this.db
        .prepare('INSERT INTO listing_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          revision,
          title,
          description,
          JSON.stringify(tags),
          license,
          'pending',
          JSON.stringify(payload),
          payload.checksum,
          null,
          now(),
        );
      this.db
        .prepare('INSERT INTO listing_events VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), id, user.id, revision, 'submit', '', now());
      return { id, revision, status: 'pending' };
    });
  }
  market(user, { q = '', mine = false, pending = false, favorites = false, offset = 0 } = {}) {
    if (
      typeof q !== 'string' ||
      q.length > 100 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 10000
    )
      invalid('检索条件无效。');
    if (pending && user?.role !== 'admin')
      throw new AppError(403, 'ADMIN_REQUIRED', '需要管理员。');
    if ((mine || favorites) && !user) throw new AppError(401, 'LOGIN_REQUIRED', '请先登录。');
    const revision = mine || pending ? 'l.current_revision' : 'l.published_revision';
    let sql = `SELECT l.id,l.user_id,l.current_revision,l.published_revision,r.revision,r.title,r.description,r.tags,r.license,r.status,r.checksum,r.review_reason,r.created_at,u.username FROM listings l JOIN listing_revisions r ON r.listing_id=l.id AND r.revision=${revision} JOIN users u ON u.id=l.user_id WHERE 1=1`,
      params = [];
    if (mine) {
      sql += ' AND l.user_id=?';
      params.push(user.id);
    } else if (pending) sql += " AND r.status='pending'";
    else sql += " AND l.published_revision IS NOT NULL AND r.status='approved'";
    if (favorites) {
      sql += ' AND EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=? AND f.listing_id=l.id)';
      params.push(user.id);
    }
    if (q) {
      sql += " AND (r.title LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\')";
      const term = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
      params.push(term, term);
    }
    sql += ' ORDER BY r.created_at DESC,l.id LIMIT 50 OFFSET ?';
    params.push(offset);
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => ({ ...r, tags: JSON.parse(r.tags), owned: r.user_id === user?.id }));
  }
  listing(id, user, revision) {
    const listing = this.db.prepare('SELECT * FROM listings WHERE id=?').get(id);
    if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', '模型不存在。');
    const owner = user && (listing.user_id === user.id || user.role === 'admin'),
      chosen = revision ?? (owner ? listing.current_revision : listing.published_revision);
    const row = this.db
      .prepare('SELECT * FROM listing_revisions WHERE listing_id=? AND revision=?')
      .get(id, chosen);
    if (!row || (!owner && (!listing.published_revision || row.status !== 'approved')))
      throw new AppError(404, 'LISTING_NOT_FOUND', '模型未公开。');
    return {
      ...listing,
      ...row,
      id,
      tags: JSON.parse(row.tags),
      payload: JSON.parse(row.payload),
      owned: listing.user_id === user?.id,
    };
  }
  reviewListing(admin, id, { revision, approve, reason = '' }) {
    if (admin.role !== 'admin') throw new AppError(403, 'ADMIN_REQUIRED', '需要管理员。');
    if (typeof approve !== 'boolean' || typeof reason !== 'string' || reason.length > 500)
      invalid('审核参数无效。');
    return this.tx(() => {
      const listing = this.db.prepare('SELECT * FROM listings WHERE id=?').get(id),
        row = this.db
          .prepare('SELECT * FROM listing_revisions WHERE listing_id=? AND revision=?')
          .get(id, revision);
      if (!listing || !row || row.status !== 'pending' || listing.current_revision !== revision)
        throw new AppError(409, 'LISTING_CHANGED', '模型版本已更新或已经审核。');
      this.db
        .prepare(
          'UPDATE listing_revisions SET status=?,review_reason=? WHERE listing_id=? AND revision=?',
        )
        .run(approve ? 'approved' : 'rejected', reason, id, revision);
      if (approve)
        this.db.prepare('UPDATE listings SET published_revision=? WHERE id=?').run(revision, id);
      this.db
        .prepare('INSERT INTO listing_events VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), id, admin.id, revision, approve ? 'approve' : 'reject', reason, now());
      return this.listing(id, admin);
    });
  }
  unpublish(user, id) {
    const row = this.db.prepare('SELECT * FROM listings WHERE id=?').get(id);
    if (!row || (row.user_id !== user.id && user.role !== 'admin'))
      throw new AppError(403, 'LISTING_OWNER', '只能下架自己的模型。');
    this.db.prepare('UPDATE listings SET published_revision=NULL WHERE id=?').run(id);
    return { unpublished: true };
  }
  favorite(user, id, value) {
    this.listing(id, user);
    if (typeof value !== 'boolean') invalid('收藏状态无效。');
    if (value) this.db.prepare('INSERT OR IGNORE INTO favorites VALUES(?,?)').run(user.id, id);
    else this.db.prepare('DELETE FROM favorites WHERE user_id=? AND listing_id=?').run(user.id, id);
    return { favorite: value };
  }
  reserve(userId, routeId, amount) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e9) invalid('预留额度无效。');
    const id = randomUUID();
    return this.tx(() => {
      if (amount) this.adjust(userId, -amount, 'usage-reservation', 'reserve:' + id, { routeId });
      this.db
        .prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?,?)')
        .run(id, userId, routeId, amount, 'pending', null, null, now());
      return id;
    });
  }
  settle(id, billed, usage, status = 'completed') {
    return this.tx(() => {
      const r = this.db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
      if (!r || r.status !== 'pending') return null;
      if (!Number.isSafeInteger(billed) || billed < 0) invalid('用量额度无效。');
      const charged = Math.min(billed, r.reserved),
        refund = r.reserved - charged;
      if (refund)
        this.adjust(
          r.user_id,
          refund,
          status === 'completed' ? 'unused-refund' : 'failed-refund',
          'settle:' + id,
          { routeId: r.route_id, usage, charged },
        );
      this.db
        .prepare('UPDATE reservations SET status=?,billed=?,usage=? WHERE id=?')
        .run(status, charged, JSON.stringify(usage ?? null), id);
      return {
        billed: charged,
        balance: this.user(r.user_id).credits,
        capped: billed > r.reserved,
      };
    });
  }
  linkWechat(openId, nickname, inviteToken, { allowRegistration = false } = {}) {
    if (typeof openId !== 'string' || openId.length > 200) invalid('微信身份无效。');
    let row = this.db.prepare('SELECT * FROM users WHERE wechat_openid=?').get(openId);
    if (row) return publicAccount(row);
    const id = randomUUID(),
      name = 'wx_' + tokenHash(openId).slice(0, 16),
      displayName = (typeof nickname === 'string' ? nickname : '微信用户').slice(0, 80);
    this.tx(() => {
      if (!allowRegistration) {
        const invite =
          typeof inviteToken === 'string'
            ? this.db.prepare('SELECT * FROM invites WHERE hash=?').get(tokenHash(inviteToken))
            : null;
        if (!invite || invite.uses_left < 1 || invite.expires_at < Date.now())
          throw new AppError(403, 'INVITE_REQUIRED', '请输入有效邀请码后重新扫码。');
        this.db.prepare('UPDATE invites SET uses_left=uses_left-1 WHERE hash=?').run(invite.hash);
      }
      this.db
        .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
        .run(id, name, displayName, null, openId, 'member', 0, now());
      this.adjust(id, 1000, 'signup-gift', 'signup:' + id);
    });
    row = this.user(id);
    return publicAccount(row);
  }
  close() {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}
