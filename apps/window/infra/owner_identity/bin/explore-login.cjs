// Focused exploration of the authentik flow stage shapes. Development aid for
// the acceptance harness; not part of the deployment path.
'use strict';
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE
  || '/worktrees/owner-crm-final-release-20260913/node_modules/playwright');

const EDGE = '127.0.0.1:9443';
const RULES = ['frank.fail', 'auth.frank.fail'].map((h) => `MAP ${h} ${EDGE}`).join(', ')
  + ', EXCLUDE localhost';

(async () => {
  fs.mkdirSync('/tmp/acc-shots', { recursive: true });
  const browser = await chromium.launch({
    args: [`--host-resolver-rules=${RULES}`, '--ignore-certificate-errors', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  const dump = async (label) => {
    const text = (await page.locator('body').innerText().catch(() => ''));
    const html = await page.content();
    fs.writeFileSync(`/tmp/acc-shots/${label}.html`, html);
    console.log(`\n===== ${label} :: ${page.url().split('?')[0]}`);
    console.log('ak- elements:', await page.evaluate(() => Array.from(document.querySelectorAll('*'))
      .map((e) => e.tagName.toLowerCase()).filter((t) => t.startsWith('ak-'))
      .filter((v, i, a) => a.indexOf(v) === i)));
    console.log('inputs:', await page.locator('input').evaluateAll((els) => els.map((e) => `${e.name || e.id || '?'}:${e.type}`)));
    console.log('buttons:', await page.locator('button').evaluateAll((els) => els.map((e) => (e.innerText || '').trim()).filter(Boolean)));
    console.log('text:', text.replace(/\n{2,}/g, ' | ').slice(0, 900));
  };

  const submit = async () => {
    const btn = page.locator('button[type="submit"], input[type="submit"]').first();
    if (await btn.count() && await btn.isVisible().catch(() => false)) {
      console.log('  -> submit button');
      await btn.click();
    } else {
      const named = page.getByRole('button', { name: /log in|continue|next|save|submit|verify/i }).first();
      if (await named.count() && await named.isVisible().catch(() => false)) {
        console.log('  -> named button');
        await named.click();
      } else {
        console.log('  -> Enter');
        await page.keyboard.press('Enter');
      }
    }
    await page.waitForTimeout(3000);
  };

  await page.goto('https://frank.fail/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await dump('e1-identification');
  await page.fill('input[name="username"]', 'owner');
  await submit();
  await dump('e2-password');
  await page.fill('input[name="password"]', process.env.PW);
  await submit();
  await dump('e3-mfa');
  await submit();
  await dump('e4-after');
  await browser.close();
})();
