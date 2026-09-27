import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const [testModule, executablePath, url, acceptance] = process.argv.slice(2);
assert.equal(acceptance, 'admin-login-retry', 'Unknown repository acceptance check');
const { chromium } = createRequire(import.meta.url)(testModule);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(url + '/admin/login');
  assert.equal(response.status(), 200);
  const email = page.getByLabel('Email', { exact: true });
  const password = page.getByLabel('Password', { exact: true });
  assert.equal(await email.getAttribute('type'), 'email');
  assert.equal(await password.getAttribute('type'), 'password');
  assert.notEqual(await email.getAttribute('required'), null);
  assert.notEqual(await password.getAttribute('required'), null);
  const label = 'Sign in';
  const button = page.getByRole('button', { name: label, exact: true });
  assert.equal(await button.count(), 1, 'Expected the requested visible submit button label');
  assert.equal(await button.getAttribute('type'), 'submit');
  let actionRequests = 0;
  const actionResponses = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/admin/login') {
      actionRequests++;
    }
  });
  page.on('response', (response) => {
    if (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/admin/login'
    ) {
      actionResponses.push({ status: response.status(), url: response.url() });
    }
  });
  await button.click();
  assert.equal(await page.locator('form').evaluate((form) => form.checkValidity()), false);
  await page.waitForTimeout(150);
  assert.equal(actionRequests, 0, 'Empty required inputs must prevent submission');
  await email.fill('evaluation@example.invalid');
  await password.fill('not-a-real-password');
  assert.equal(await page.locator('form').evaluate((form) => form.checkValidity()), true);
  // Delay this real Server Action request so the pending state can be observed reliably.
  let release;
  let pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/admin/login', async (route) => {
    if (route.request().method() === 'POST') {
      await pending;
    }
    await route.continue();
  });
  await button.click();
  try {
    await page.getByRole('button', { name: 'Signing in...', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Signing in...', exact: true }).isDisabled(),
      true,
    );
  } finally {
    release();
  }
  const alert = page.getByRole('alert').filter({ hasText: 'Invalid email or password.' });
  try {
    await alert.waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    throw new Error(
      `Login failure alert did not become visible: ${JSON.stringify({
        actionRequests,
        actionResponses,
        pageErrors: errors,
        url: page.url(),
        body: (await page.locator('body').innerText()).slice(0, 4000),
      })}`,
      { cause: error },
    );
  }
  assert.equal(actionRequests, 1, 'Valid submission must invoke the real login Server Action.');
  try {
    await button.click({ trial: true, timeout: 5000 });
  } catch (error) {
    throw new Error('Failed sign-in must allow another attempt.', { cause: error });
  }
  // A second attempt must preserve validation and perform a new real action.
  await password.fill('');
  await button.click();
  await page.waitForTimeout(150);
  assert.equal(actionRequests, 1, 'Required validation must still block empty retry credentials.');
  await email.fill('retry@example.invalid');
  await password.fill('another-not-real-password');
  pending = new Promise((resolve) => {
    release = resolve;
  });
  const secondResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/admin/login',
  );
  await button.click();
  try {
    await page.getByRole('button', { name: 'Signing in...', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Signing in...', exact: true }).isDisabled(),
      true,
      'Retry must preserve pending feedback.',
    );
  } finally {
    release();
  }
  await secondResponse;
  await page.getByRole('button', { name: label, exact: true }).waitFor();
  await alert.waitFor({ state: 'visible' });
  assert.equal(actionRequests, 2, 'Retry must invoke a second real login Server Action.');
  await button.click({ trial: true, timeout: 5000 });
  assert.equal(await button.isEnabled(), true, 'A failed retry must permit another attempt.');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      route: '/admin/login',
      label,
      pendingDisabled: true,
      requiredInputValidation: true,
      serverActionRequests: actionRequests,
      errorVisible: true,
      retryAccepted: true,
      retryPendingDisabled: true,
      retryRequiredValidation: true,
      hydratedWithoutErrors: true,
      authentication:
        'Only the unavailable local auth endpoint error path is exercised; successful authentication and Supabase are not evaluated.',
    }),
  );
} finally {
  await browser.close();
}
