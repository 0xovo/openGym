/* The account's own delete (App Store rule 5.1.1(v)): a signed-in profile removes itself with
   the same clean-up the admin's delete runs (removeAccount in server.js), typing its name back
   to confirm, and the last admin cannot leave an instance others still use. Real server.js in a
   child, same harness as server-admin-delete.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const ADMIN = 'u_adm_1', ADMIN2 = 'u_adm_2', USER = 'u_usr_1';
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' });
async function startServer(t, { users: which = ['admin', 'user'] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-selfdel-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const all = {
    admin: { id: ADMIN, name: 'Adminna', created: new Date().toISOString(), admin: true },
    admin2: { id: ADMIN2, name: 'Second', created: new Date().toISOString(), admin: true },
    user: { id: USER, name: 'Mallory', created: new Date().toISOString(), invitedBy: 'CODE1' },
  };
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: which.map(k => all[k]),
    creds: [{ id: 'c-user', userId: USER, publicKey: 'x' }, { id: 'c-admin', userId: ADMIN, publicKey: 'y' }],
    subs: [{ endpoint: 'https://push/user', userId: USER }, { endpoint: 'https://push/admin', userId: ADMIN }],
    invites: [{ code: 'CODE1', usedBy: USER, usedAt: new Date().toISOString() }],
  }));
  for (const uid of [USER, ADMIN]) fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify({ unit: 'kg', workouts: [], _rev: 3 }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
  });
  const h = { api: '', log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.del = async (uid, body) => {
    const r = await fetch(`${h.api}/api/account/delete`, { method: 'POST', headers: as(uid), body: JSON.stringify(body) });
    return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') || '' };
  };
  h.db = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  h.audit = () => fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  return h;
}

test('removes the account and everything attached to it, and ends the session', async t => {
  const h = await startServer(t);
  const res = await h.del(USER, { name: 'Mallory' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.match(res.cookie, /gymsid=;.*Max-Age=0/, 'the session cookie is cleared');

  const db = h.db();
  assert.deepEqual(db.users.map(u => u.id), [ADMIN], 'the user is gone');
  assert.deepEqual(db.creds.map(c => c.userId), [ADMIN], 'their passkeys are gone');
  assert.deepEqual(db.subs.map(s => s.userId), [ADMIN], 'their push subscriptions are gone');
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${USER}.json`)), false, 'their history is gone');
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${ADMIN}.json`)), true, 'nobody else’s is touched');
  assert.equal(db.invites[0].usedBy, USER, 'the code they joined with stays burned');

  const me = await fetch(`${h.api}/api/me`, { headers: as(USER) });
  assert.equal(me.status, 401, 'a cookie for a deleted account is worthless');
  const ev = h.audit().find(r => r.ev === 'auth.account.delete');
  assert.ok(ev, 'audited');
  assert.equal(ev.uid, USER);
  assert.equal(ev.name, 'Mallory', 'by name, since the id stops meaning anything');
  assert.equal(h.stackFrames(), 0, `no stack traces:\n${h.log}`);
});

test('needs the account name typed back', async t => {
  const h = await startServer(t);
  for (const body of [{}, { name: '' }, { name: 'mallory' }, { name: 'Adminna' }, { name: 42 }]) {
    const res = await h.del(USER, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, 'confirm-name');
  }
  assert.equal(h.db().users.length, 2, 'nothing was removed');
  // Spaces around it are a keyboard's, not a different name.
  assert.equal((await h.del(USER, { name: ' Mallory ' })).status, 200);
});

test('needs a session, and a request from another origin is refused', async t => {
  const h = await startServer(t);
  const anon = await fetch(`${h.api}/api/account/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8080' }, body: JSON.stringify({ name: 'Mallory' }) });
  assert.equal(anon.status, 401);
  const cross = await fetch(`${h.api}/api/account/delete`, { method: 'POST', headers: { ...as(USER), Origin: 'https://evil.example' }, body: JSON.stringify({ name: 'Mallory' }) });
  assert.equal(cross.status, 403);
  assert.equal(h.db().users.length, 2);
});

test('the last admin cannot leave while other profiles remain', async t => {
  const h = await startServer(t);
  const res = await h.del(ADMIN, { name: 'Adminna' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'last-admin');
  assert.equal(h.db().users.length, 2, 'nothing was removed');
});

test('an admin can leave while another admin remains', async t => {
  const h = await startServer(t, { users: ['admin', 'admin2', 'user'] });
  assert.equal((await h.del(ADMIN, { name: 'Adminna' })).status, 200);
  assert.deepEqual(h.db().users.map(u => u.id).sort(), [ADMIN2, USER].sort());
});

test('the only profile on the instance can delete itself, admin or not', async t => {
  const h = await startServer(t, { users: ['admin'] });
  assert.equal((await h.del(ADMIN, { name: 'Adminna' })).status, 200);
  assert.deepEqual(h.db().users, []);
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${ADMIN}.json`)), false);
});

test('a paired phone deletes with its Bearer token', async t => {
  const h = await startServer(t);
  const r = await fetch(`${h.api}/api/account/delete`, {
    method: 'POST', headers: { Authorization: `Bearer ${mintSession(USER)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Mallory' })
  });
  assert.equal(r.status, 200);
  assert.deepEqual(h.db().users.map(u => u.id), [ADMIN]);
});
