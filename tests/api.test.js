const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (_error) {
      // Retry until timeout.
    }
    await delay(250);
  }

  throw new Error('Server did not become ready in time');
}

function startServer(port, dbPath) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DB_PATH: dbPath,
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    DISABLE_STARTUP_JOBS: '1',
    CORS_ORIGIN: '*',
  };

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  return {
    child,
    getLogs: () => logs,
  };
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  let body = null;
  try {
    body = await response.json();
  } catch (_error) {
    body = null;
  }
  return { response, body };
}

test('auth + verification + password reset flow', async (t) => {
  const port = 4300 + Math.floor(Math.random() * 200);
  const dbPath = path.join(ROOT, 'data', `test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const baseUrl = `http://127.0.0.1:${port}`;

  const server = startServer(port, dbPath);
  await waitForHealth(baseUrl);

  t.after(async () => {
    server.child.kill('SIGTERM');
    await delay(400);

    [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].forEach((target) => {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    });
  });

  const email = `test_${Date.now()}@example.com`;
  const password = 'password123';

  const register = await requestJson(baseUrl, '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      displayName: 'Tester',
      timezone: 'America/New_York',
    }),
  });

  assert.equal(register.response.status, 201, server.getLogs());
  assert.equal(register.body.requiresEmailVerification, true);

  const loginBeforeVerify = await requestJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, timezone: 'America/New_York' }),
  });

  assert.equal(loginBeforeVerify.response.status, 403, JSON.stringify(loginBeforeVerify.body));

  const db = new Database(dbPath);
  const verifyTokenRow = db.prepare(`
    SELECT evt.token
    FROM email_verification_tokens evt
    JOIN users u ON u.id = evt.user_id
    WHERE u.email = ? AND evt.used_at IS NULL
    ORDER BY evt.created_at DESC
    LIMIT 1
  `).get(email);
  db.close();

  assert.ok(verifyTokenRow?.token, 'Expected verification token');

  const verify = await requestJson(baseUrl, '/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: verifyTokenRow.token }),
  });
  assert.equal(verify.response.status, 200, JSON.stringify(verify.body));

  const login = await requestJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, timezone: 'America/New_York' }),
  });

  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  assert.ok(login.body.token);

  const token = login.body.token;
  const reminders = await requestJson(baseUrl, '/api/reminders', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(reminders.response.status, 200);

  const forgot = await requestJson(baseUrl, '/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(forgot.response.status, 200);

  const db2 = new Database(dbPath);
  const resetTokenRow = db2.prepare(`
    SELECT prt.token
    FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id
    WHERE u.email = ? AND prt.used_at IS NULL
    ORDER BY prt.created_at DESC
    LIMIT 1
  `).get(email);
  db2.close();

  assert.ok(resetTokenRow?.token, 'Expected password reset token');

  const reset = await requestJson(baseUrl, '/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: resetTokenRow.token, newPassword: 'password456' }),
  });
  assert.equal(reset.response.status, 200);

  const loginOldPassword = await requestJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, timezone: 'America/New_York' }),
  });
  assert.equal(loginOldPassword.response.status, 401);

  const loginNewPassword = await requestJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password456', timezone: 'America/New_York' }),
  });
  assert.equal(loginNewPassword.response.status, 200);
});

test('oauth providers endpoint reports disabled by default', async (t) => {
  const port = 4500 + Math.floor(Math.random() * 200);
  const dbPath = path.join(ROOT, 'data', `test-oauth-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const baseUrl = `http://127.0.0.1:${port}`;

  const server = startServer(port, dbPath);
  await waitForHealth(baseUrl);

  t.after(async () => {
    server.child.kill('SIGTERM');
    await delay(400);

    [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].forEach((target) => {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    });
  });

  const providers = await requestJson(baseUrl, '/api/auth/oauth/providers');
  assert.equal(providers.response.status, 200);
  assert.equal(providers.body.google, false);
  assert.equal(providers.body.github, false);
});
