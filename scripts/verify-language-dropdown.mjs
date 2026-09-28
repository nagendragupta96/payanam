// Synthetic session and mocked external traffic: no production data is changed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE + '/index.mjs').href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext();
  const user = { id: '10000000-0000-0000-0000-000000000001', email: 'languages@example.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, role: 'authenticated', exp: expires })}.local-test`,
    refresh_token: 'local-test', token_type: 'bearer', expires_at: expires, expires_in: 3600, user };
  await context.addInitScript(value => localStorage.setItem('sb-ghrgzwfiiqeeamkhilfk-auth-token', JSON.stringify(value)), session);
  const trip = { id: '20000000-0000-0000-0000-000000000001', owner_id: user.id,
    origin_airport_code: 'JFK', destination_airport_code: 'HYD',
    start_date: '2099-12-01', end_date: '2099-12-02', languages_known: [] };
  const legs = [{ itinerary_id: trip.id, leg_order: 1, origin_airport_code: 'JFK', destination_airport_code: 'HYD', flight_number: 'EK524' }];
  const writes = [];
  await context.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).hostname === '127.0.0.1') socket.connectToServer(); else socket.close();
  });
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (!url.hostname.endsWith('.supabase.co')) return route.abort();
    const name = url.pathname.split('/').pop();
    let data = [];
    if (url.pathname.includes('/auth/')) data = name === 'user' ? user : session;
    else if (name === 'is_app_admin') data = false;
    else if (name === 'profiles') data = [{ id: user.id, display_name: 'Language test' }];
    else if (name === 'itineraries') {
      if (['POST', 'PATCH'].includes(request.method())) {
        const payload = request.postDataJSON();
        writes.push(payload);
        Object.assign(trip, payload);
      }
      data = [trip];
    } else if (name === 'itinerary_legs') data = request.method() === 'GET' ? legs : [];
    if (request.headers()['accept']?.includes('application/vnd.pgrst.object+json') && Array.isArray(data)) data = data[0] ?? null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.LANGUAGE_TEST_URL || 'http://127.0.0.1:4201';
  await page.goto(base + '/create-itinerary');
  const summary = page.locator('#languagesKnown');
  await summary.waitFor();
  assert.equal(await page.locator('input[formControlName="languages_known"]').count(), 0);
  await summary.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('checkbox', { name: 'English', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Telugu', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Hindi', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Hindi', exact: true }).uncheck();
  assert.equal(await summary.innerText(), 'English, Telugu');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.language-dropdown').getAttribute('open'), null);
  await page.locator('#originAirport').fill('JFK');
  await page.locator('#destinationAirport').fill('HYD');
  await page.locator('#startDate').fill(trip.start_date);
  await page.locator('#endDate').fill(trip.end_date);
  await page.locator('[formArrayName="legs"] [formControlName="origin_airport_code"]').fill('JFK');
  await page.locator('[formArrayName="legs"] [formControlName="destination_airport_code"]').fill('HYD');
  await page.locator('[formControlName="flight_number"]').fill('EK524');
  await page.getByRole('button', { name: 'Publish itinerary', exact: true }).click();
  await page.waitForURL('**/my-trips?**');
  assert.deepEqual(writes.at(-1).languages_known, ['English', 'Telugu']);

  trip.languages_known = ['english', 'Telugu', 'Legacy language'];
  await page.goto(base + '/edit-itinerary/' + trip.id);
  await page.getByRole('button', { name: 'Save Itinerary Changes' }).waitFor();
  await summary.filter({ hasText: 'Legacy language' }).waitFor();
  await summary.click();
  assert.equal(await page.getByRole('checkbox', { name: 'English', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: 'Legacy language', exact: true }).isChecked(), true);
  await mkdir('.artifacts', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await summary.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Fits ${width}px`);
    await page.screenshot({ path: `.artifacts/language-dropdown-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Save Itinerary Changes' }).click();
  await page.waitForURL('**/my-trips?**');
  assert.deepEqual(writes.at(-1).languages_known, ['English', 'Telugu', 'Legacy language']);

  await page.goto(base + '/create-itinerary');
  await summary.click();
  const checkboxes = page.locator('.language-options input');
  for (let index = 0; index < 20; index++) await checkboxes.nth(index).check();
  assert.equal(await checkboxes.nth(20).isDisabled(), true);
  await checkboxes.nth(0).uncheck();
  assert.equal(await checkboxes.nth(20).isDisabled(), false);
  for (let index = 1; index < 20; index++) await checkboxes.nth(index).uncheck();
  assert.equal(await summary.innerText(), 'Select languages');
  assert.deepEqual(errors, []);
  console.log('PASS: dropdown keyboard access, multi-select, removal, create/edit payloads, legacy values, selection limit, and desktop/mobile layout.');
} finally {
  await browser.close();
}
