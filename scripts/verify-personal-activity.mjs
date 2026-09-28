// Local-only browser checks. External HTTP/WebSockets are mocked or blocked.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE + '/index.mjs').href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext();
  const user = { id: '10000000-0000-0000-0000-000000000001', email: 'activity@example.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: {} };
  const owner = '10000000-0000-0000-0000-000000000002';
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, role: 'authenticated', exp: expiry })}.local-test`,
    refresh_token: 'local-test', token_type: 'bearer', expires_at: expiry, expires_in: 3600, user };
  await context.addInitScript(value => localStorage.setItem('sb-ghrgzwfiiqeeamkhilfk-auth-token', JSON.stringify(value)), session);
  const events = [
    { id: 3, created_at: new Date().toISOString(), source: 'client', action: 'click', performed_by_you: true, details: { area: 'create-itinerary', control: 'publish' } },
    { id: 2, created_at: new Date().toISOString(), source: 'database', action: 'notifications.insert', affects_you: true, details: { notification_type: 'AUTO_MATCH' } },
    { id: 1, created_at: new Date().toISOString(), source: 'database', action: 'sessions.insert', affects_you: true, details: {} }
  ];
  const trips = [
    { id: '20000000-0000-0000-0000-000000000001', owner_id: null, is_anonymous: true, posted_by: 'Anonymous' },
    { id: '20000000-0000-0000-0000-000000000002', owner_id: owner, is_anonymous: false, posted_by: 'Named Traveler' }
  ].map(trip => ({ ...trip, origin_airport_code: 'JFK', destination_airport_code: 'HYD', start_date: '2099-12-01', end_date: '2099-12-02', languages_known: ['English'], legs: [] }));
  const telemetry = []; const requests = [];
  let failActivity = false; let empty = false;
  await context.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).hostname === '127.0.0.1') socket.connectToServer(); else socket.close();
  });
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (!url.hostname.endsWith('.supabase.co')) return route.abort();
    const name = url.pathname.split('/').pop();
    const body = request.postData() ? request.postDataJSON() : {};
    requests.push({ name, body });
    let data = []; let status = 200;
    if (url.pathname.includes('/auth/')) data = name === 'user' ? user : session;
    else if (name === 'is_app_admin') data = false;
    else if (name === 'profiles') data = [{ id: user.id, display_name: 'Activity test' }];
    else if (name === 'record_client_activity') { telemetry.push(...body.p_events); data = null; }
    else if (name === 'my_activity') {
      let rows = events.filter(event => !body.p_before || event.id < body.p_before);
      if (body.p_category === 'notifications') rows = rows.filter(event => event.action.startsWith('notifications.'));
      if (body.p_category === 'actions') rows = rows.filter(event => !event.action.startsWith('notifications.'));
      data = { rows: empty ? [] : rows.slice(0, 2), has_more: !empty && rows.length > 2 };
      if (failActivity) { status = 503; data = { message: 'Test outage' }; }
    } else if (name === 'public_itinerary_search') {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      data = id ? trips.filter(trip => trip.id === id) : trips;
    } else if (name === 'create_itinerary_request') {
      data = { data: { id: '30000000-0000-0000-0000-000000000001', itinerary_id: body.p_itinerary, owner_id: owner, requester_id: user.id, request_type: body.p_type, status: 'PENDING' }, existing: false };
    }
    if (request.headers()['accept']?.includes('application/vnd.pgrst.object+json') && Array.isArray(data)) data = data[0] ?? null;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.ACTIVITY_TEST_URL || 'http://127.0.0.1:4201';
  await page.goto(base + '/activity');
  await page.getByText('You selected Publish itinerary in Post Trip.', { exact: true }).waitFor();
  await page.getByText('You received a matching trip notification.', { exact: true }).waitFor();
  assert.equal(await page.locator('pre').count(), 0);
  await mkdir('.artifacts', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Activity fits ${width}px`);
    await page.screenshot({ path: `.artifacts/personal-activity-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByText('You signed in.', { exact: true }).waitFor();
  assert.equal(requests.filter(item => item.name === 'my_activity').at(-1).body.p_before, 2);
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await page.getByText('You selected Publish itinerary in Post Trip.', { exact: true }).waitFor();
  await page.getByLabel('Activity type').selectOption('notifications');
  await page.getByText('You received a matching trip notification.', { exact: true }).waitFor();
  assert.equal(await page.getByText('You selected Publish itinerary in Post Trip.', { exact: true }).count(), 0);
  failActivity = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('alert').waitFor();
  failActivity = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText('You received a matching trip notification.', { exact: true }).waitFor();
  empty = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('No activity found.', { exact: true }).waitFor();
  empty = false;
  await page.goto(base + '/search');
  await page.locator('[formControlName="originAirportCode"]').fill('JFK');
  await page.locator('[formControlName="destinationAirportCode"]').fill('HYD');
  await page.locator('[formControlName="searchStartDate"]').fill('2099-12-01');
  await page.locator('[formControlName="searchEndDate"]').fill('2099-12-02');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('cell', { name: 'Anonymous', exact: true }).waitFor();
  await page.getByRole('cell', { name: 'Named Traveler', exact: true }).waitFor();
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  await page.getByRole('dialog').getByText('Posted by: Anonymous', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Companion Request', exact: true }).click();
  await page.waitForURL('**/requests/*');
  const create = requests.find(item => item.name === 'create_itinerary_request');
  assert.equal(create.body.p_itinerary, trips[0].id);
  assert.equal(Object.hasOwn(create.body, 'owner_id'), false);
  await page.waitForTimeout(1200);
  assert.ok(telemetry.some(event => event.action === 'click' && event.control === 'search'));
  assert.ok(!telemetry.some(event => event.control?.includes('/my_activity')));
  assert.ok(!JSON.stringify(telemetry).includes(user.email));
  assert.deepEqual(errors, []);

  // A second browser without a session cannot open personal activity.
  const guest = await browser.newContext();
  await guest.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const guestPage = await guest.newPage();
  await guestPage.goto(base + '/activity');
  await guestPage.waitForURL('**/auth**');
  console.log('PASS: personal history, filters, pagination, errors/retry, empty state, telemetry privacy, guest guard, anonymous/named search, and anonymous trip requests.');
} finally { await browser.close(); }
