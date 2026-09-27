// Uses synthetic accounts only. Every external HTTP/WebSocket request is mocked
// or blocked, so this script cannot delete real accounts or posts.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE + '/index.mjs').href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
const user = { id: '10000000-0000-0000-0000-000000000001', email: 'admin@example.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: {} };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const session = { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.local-test',
  refresh_token: 'local-test', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user };
await context.addInitScript(session => localStorage.setItem('sb-ghrgzwfiiqeeamkhilfk-auth-token', JSON.stringify(session)), session);
let allowed = true; let failDelete = false; let failList = false; let failTelemetry = false;
const calls = []; const telemetry = [];
const now = new Date().toISOString();
let users = Array.from({ length: 27 }, (_, index) => ({ id: `10000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
  email: `user${index}@example.invalid`, display_name: `Test user ${index}`, created_at: now, last_sign_in_at: now,
  is_admin: index === 0, is_premium: index % 2 === 0, posts: index }));
let posts = [{ id: '20000000-0000-0000-0000-000000000001', owner_id: users[1].id,
  owner_email: users[1].email, origin_airport_code: 'JFK', destination_airport_code: 'LHR', start_date: '2026-12-01', end_date: '2026-12-03', created_at: now, requests: 4 }];
const events = [{ id: 1, created_at: now, actor_id: user.id, actor_is_admin: true, source: 'admin', action: 'admin.delete_post', entity_type: 'itineraries', entity_id: posts[0].id, subject_user_id: users[1].id, details: { reason: 'Duplicate trip' } },
  { id: 2, created_at: now, actor_id: users[1].id, actor_is_admin: false, source: 'database', action: 'notifications.insert', entity_type: 'notifications', entity_id: posts[0].id, subject_user_id: user.id, details: { notification_type: 'AUTO_MATCH', is_read: false } }];
await context.routeWebSocket('**/*', socket => {
  if (new URL(socket.url()).hostname === '127.0.0.1') socket.connectToServer(); else socket.close();
});
await context.route('**/*', async route => {
  const request = route.request(); const url = new URL(request.url());
  if (url.hostname === '127.0.0.1') return route.continue();
  if (!url.hostname.endsWith('.supabase.co')) return route.abort();
  const name = url.pathname.split('/').pop();
  let data = []; let status = 200;
  const body = request.postData() ? request.postDataJSON() : {};
  if (url.pathname.includes('/auth/')) data = name === 'user' ? user : session;
  else if (name === 'is_app_admin') data = allowed;
  else if (name === 'record_client_activity') {
    telemetry.push(...body.p_events);
    data = null;
    if (failTelemetry) { status = 503; data = { message: 'Test activity outage' }; }
  } else if (name.startsWith('admin_')) {
    calls.push({ name, body });
    if (!allowed) { status = 403; data = { message: 'Administrator access required.', code: '42501' }; }
    else if (name === 'admin_overview') data = { users: 27, new_users_30d: 4, admins: 1, premium_users: 14, posts: 37, upcoming_posts: 30, new_posts_30d: 10, requests: 45, pending_requests: 20, accepted_requests: 25, conversations: 14, messages: 120, notifications: 40, unread_notifications: 4, completed_demo_checkouts: 12, active_users_7d: 9, events_24h: 250, client_errors_24h: 2 };
    else if (name === 'admin_list') {
      if (failList) { status = 503; data = { message: 'Test list unavailable' }; }
      else {
        let rows = body.p_section === 'users' ? users : body.p_section === 'posts' ? posts : events;
        if (body.p_search) rows = rows.filter(row => JSON.stringify(row).includes(body.p_search));
        if (body.p_source) rows = rows.filter(row => row.source === body.p_source);
        data = { rows: rows.slice(body.p_offset, body.p_offset + body.p_limit), total: rows.length };
      }
    } else if (name.startsWith('admin_delete_')) {
      if (failDelete) { status = 400; data = { message: 'Account owns Storage files.' }; }
      else { if (name === 'admin_delete_user') users = users.filter(row => row.id !== body.p_id); else posts = posts.filter(row => row.id !== body.p_id); data = null; }
    }
  } else if (name === 'profiles') data = [{ id: user.id, display_name: 'Test administrator', avatar_url: null }];
  if (request.headers()['accept']?.includes('application/vnd.pgrst.object+json') && Array.isArray(data)) data = data[0] ?? null;
  await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(data) });
});
const page = await context.newPage(); const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.ADMIN_TEST_URL || 'http://127.0.0.1:4201';
try {
  await mkdir('.artifacts', { recursive: true });
  await page.goto(base + '/admin');
  await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overview fits ${width}`);
    await page.screenshot({ path: `.artifacts/admin-overview-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await page.getByText('1-25 of 27', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Delete account' }).first().isDisabled(), true);
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByText('26-27 of 27', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.getByText('1-25 of 27', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Delete account' }).nth(1).click();
  assert.equal(await page.getByRole('button', { name: 'Delete permanently' }).isDisabled(), true);
  await page.getByLabel('Reason', { exact: true }).fill('Confirmed duplicate test account');
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.screenshot({ path: '.artifacts/admin-delete-confirmation.png', fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(calls.filter(call => call.name === 'admin_delete_user').length, 0);
  await page.getByRole('button', { name: 'Delete account' }).nth(1).click();
  await page.getByLabel('Reason', { exact: true }).fill('Confirmed duplicate test account');
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  failDelete = true;
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await page.getByRole('alert').filter({ hasText: 'Storage files' }).waitFor();
  assert.equal(users.length, 27);
  failDelete = false;
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await page.getByText('Account deleted.', { exact: true }).waitFor();
  await page.getByText('1-25 of 26', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Posts', exact: true }).click();
  await page.getByRole('button', { name: 'Delete post' }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Duplicate itinerary');
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await page.getByText('No posts found.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await page.getByRole('cell', { name: 'notifications.insert database', exact: true }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Activity fits ${width}`);
    await page.screenshot({ path: `.artifacts/admin-activity-${width}.png`, fullPage: true });
  }
  await page.getByLabel('Source', { exact: true }).selectOption('database');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await page.getByText('1-1 of 1', { exact: true }).waitFor();
  assert.equal(calls.at(-1).body.p_source, 'database');
  failList = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Test list unavailable' }).waitFor();
  failList = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText('1-1 of 1', { exact: true }).waitFor();
  failTelemetry = true;
  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await page.getByText('1-25 of 26', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('sensitive-search@example.invalid');
  await page.waitForTimeout(1500);
  const serialized = JSON.stringify(telemetry);
  for (const secret of ['sensitive-search@', 'Confirmed duplicate', 'access_token', 'local-test', 'DELETE']) assert.equal(serialized.includes(secret), false, secret);
  assert.ok(telemetry.some(event => event.action === 'navigation'));
  assert.ok(telemetry.some(event => event.action === 'api.success'));
  assert.ok(telemetry.some(event => event.action === 'click'));
  assert.ok(!serialized.includes('record_client_activity'));
  allowed = false;
  await page.goto(base + '/admin');
  await page.getByText('Administrator access is required to view this page.', { exact: true }).waitFor();
  assert.equal(await page.locator('app-overflow-nav a').filter({ hasText: /^Admin$/ }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: admin guard, stats, pagination, both deletions, cancel/failure/retry, activity filters, desktop/mobile layout, telemetry privacy/non-recursion/outage.');
} finally { await context.close(); await browser.close(); }
