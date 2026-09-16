import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const [testModule, executablePath, url, acceptance, targetPath] = process.argv.slice(2);
assert.ok(
  ['admin-login-copy', 'local-development-docs', 'admin-login-visible-error'].includes(acceptance),
  'Unknown repository acceptance check',
);
if (acceptance === 'local-development-docs') {
  const text = await readFile(targetPath, 'utf8');
  const heading = /^##[ \t]+Verify the admin login page[ \t]*\r?$/im.exec(text);
  assert.ok(heading, 'The requested verification section must exist.');
  const section = text.slice(heading.index + heading[0].length).split(/^#{1,2}[ \t]/m)[0];
  assert.match(section, /pnpm dev/, 'The new section must include the startup command.');
  assert.match(section, /\/admin\/login/, 'The new section must include the login route.');
  console.log(
    'Documentation presence check passed: the new section contains the startup command and route. Meaning and the render-versus-authentication distinction require semantic or human judgment.',
  );
} else {
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
    const label = acceptance === 'admin-login-copy' ? 'Sign in to manage the wedding' : 'Sign in';
    const button = page.getByRole('button', { name: label, exact: true });
    assert.equal(await button.count(), 1, 'Expected the requested visible submit button label');
    assert.equal(await button.getAttribute('type'), 'submit');
    let actionRequests = 0;
    const actionResponses = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/admin/login')
        actionRequests++;
    });
    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/admin/login'
      )
        actionResponses.push({ status: response.status(), url: response.url() });
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
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/admin/login', async (route) => {
      if (route.request().method() === 'POST') await pending;
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
    assert.equal(await page.getByRole('button', { name: label, exact: true }).isEnabled(), true);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        route: '/admin/login',
        label,
        pendingDisabled: true,
        requiredInputValidation: true,
        serverActionRequests: actionRequests,
        errorVisible: true,
        hydratedWithoutErrors: true,
        authentication:
          'Only the unavailable local auth endpoint error path is exercised; successful authentication and Supabase are not evaluated.',
      }),
    );
  } finally {
    await browser.close();
  }
}
