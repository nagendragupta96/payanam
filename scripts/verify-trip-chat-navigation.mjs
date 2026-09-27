// Local browser verification only. All external HTTP/WebSocket traffic is mocked or blocked.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE + '/index.mjs').href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
const user = { id: '10000000-0000-0000-0000-000000000001', email: 'local-test@example.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: {} };
const tripId = '20000000-0000-0000-0000-000000000001';
const threadId = '30000000-0000-0000-0000-000000000001';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const session = {
  access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.local-test',
  refresh_token: 'local-test', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user
};
await context.addInitScript(({ session }) => {
  localStorage.setItem('sb-ghrgzwfiiqeeamkhilfk-auth-token', JSON.stringify(session));
}, { session });
let trip;
let legs = [];
let messages = [];
const writes = [];
await context.routeWebSocket('**/*', socket => {
  if (new URL(socket.url()).hostname === '127.0.0.1') socket.connectToServer();
  else socket.close();
});
await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.hostname === '127.0.0.1') return route.continue();
  if (!url.hostname.endsWith('.supabase.co')) return route.abort();
  const table = url.pathname.split('/').pop();
  const method = request.method();
  let data = [];
  if (url.pathname.includes('/auth/')) data = table === 'user' ? user : session;
  else if (url.pathname.includes('/rpc/')) data = 0;
  else if (table === 'profiles') data = [{ id: user.id, display_name: 'Local Tester', avatar_url: null }];
  else if (table === 'itineraries') {
    if (method === 'POST' || method === 'PATCH') {
      const payload = request.postDataJSON();
      writes.push(payload);
      assert.equal(Object.hasOwn(payload, 'destination'), false);
      trip = { ...trip, ...payload, id: tripId };
    }
    data = trip ? [{ ...trip, legs }] : [];
  } else if (table === 'itinerary_legs') {
    if (method === 'POST') legs = request.postDataJSON();
    if (method === 'DELETE') legs = [];
    data = legs;
  } else if (table === 'chat_threads') {
    data = [{ id: threadId, owner_id: user.id, requester_id: '10000000-0000-0000-0000-000000000002', request_id: tripId, requests: { request_type: 'COMPANION' } }];
  } else if (table === 'chat_messages') {
    if (method === 'POST') messages.push({ ...request.postDataJSON(), id: tripId, created_at: new Date().toISOString() });
    data = messages;
  }
  if (request.headers()['accept']?.includes('application/vnd.pgrst.object+json') && Array.isArray(data)) data = data[0] ?? null;
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(data) });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await mkdir('.artifacts', { recursive: true });
  await page.goto('http://127.0.0.1:4200/create-itinerary');
  await page.locator('#originAirport').waitFor();
  assert.equal(await page.locator('#destinationLabel, [formcontrolname="destination"]').count(), 0);
  for (const width of [1600, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForTimeout(250);
    const layout = await page.locator('app-overflow-nav').evaluate(host => {
      const available = host.querySelector('.nav-available').getBoundingClientRect();
      const entries = [...host.querySelectorAll('.nav-visible .nav-entry')].map(item => item.getBoundingClientRect());
      return { visible: entries.length, fits: entries.every(item => item.left >= available.left - 1 && item.right <= available.right + 1),
        noOverlap: entries.every((item, index) => !index || item.left >= entries[index - 1].right),
        pageFits: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.ok(layout.fits && layout.noOverlap && layout.pageFits, JSON.stringify({ width, layout }));
    assert.ok(layout.visible >= 1);
    const more = page.getByRole('button', { name: /^More/ });
    if (await more.count()) {
      await more.click();
      assert.equal(await page.locator('.nav-visible a, .nav-visible .logout-entry, #nav-overflow a, #nav-overflow .logout-entry').count(), 10);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#nav-overflow').count(), 0);
      assert.equal(await more.getAttribute('aria-expanded'), 'false');
    }
    await page.screenshot({ path: '.artifacts/navigation-' + width + '.png', fullPage: true });
    console.log('Navigation viewport passed:', width, layout.visible);
  }
  await page.setViewportSize({ width: 1280, height: 950 });
  const date = new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10);
  await page.locator('#originAirport').fill('JFK');
  await page.locator('#destinationAirport').fill('LHR');
  await page.locator('#startDate').fill(date);
  await page.locator('#endDate').fill(date);
  await page.locator('[formarrayname="legs"] [formcontrolname="origin_airport_code"]').fill('JFK');
  await page.locator('[formarrayname="legs"] [formcontrolname="destination_airport_code"]').fill('LHR');
  await page.locator('[formcontrolname="flight_number"]').fill('BA123');
  await page.getByRole('button', { name: 'Publish itinerary' }).click();
  await page.waitForURL('**/my-trips?**');
  assert.equal(await page.getByRole('columnheader', { name: 'Destination', exact: true }).count(), 0);
  assert.equal(writes.length, 1);
  await page.goto('http://127.0.0.1:4200/edit-itinerary/' + tripId);
  await page.locator('#originAirport').waitFor();
  await page.waitForFunction(() => document.querySelector('#originAirport')?.value === 'JFK');
  await page.locator('#tripNotes').fill('Updated trip');
  await page.getByRole('button', { name: 'Save Itinerary Changes' }).click();
  await page.waitForURL('**/my-trips?**');
  assert.equal(writes.length, 2);
  await page.goto('http://127.0.0.1:4200/messages/' + threadId);
  await page.getByPlaceholder('Type your message').waitFor();
  await page.getByPlaceholder('Type your message').fill('Call me on +1 (202) 555-0123');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator('.chat-bubble').filter({ hasText: '+1 (202) 555-0123' }).waitFor();
  assert.equal(messages[0].body, 'Call me on +1 (202) 555-0123');
  await page.setViewportSize({ width: 390, height: 950 });
  await page.getByRole('button', { name: /^More/ }).waitFor();
  await page.getByRole('button', { name: /^More/ }).click();
  await page.screenshot({ path: '.artifacts/navigation-overflow-mobile.png', fullPage: true });
  await page.locator('#nav-overflow').getByRole('link', { name: 'Profile' }).click();
  await page.waitForURL('**/profile');
  assert.equal(await page.locator('#nav-overflow').count(), 0);
  await page.getByRole('button', { name: /^More/ }).click();
  await page.locator('#nav-overflow').getByRole('button', { name: 'Logout' }).click();
  await page.getByRole('link', { name: 'Login', exact: true }).waitFor();
  assert.equal(await page.locator('nav').getByRole('link', { name: 'My Trips' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Create/edit payloads, chat phone sending, overflow links and logout passed. No browser errors.');
} finally {
  await context.close();
  await browser.close();
}
