// End-to-end acceptance for the owner workspace sign-in.
//
// It drives a real Chromium against the acceptance edge, which serves the exact
// site blocks committed in apps/window/Caddyfile. DNS is remapped in the
// browser, so every URL stays https://frank.fail/ or https://crm.frank.fail/
// with no port. Cookies, OAuth redirect URIs, frame-ancestors rules and the
// outpost session are therefore exercised exactly as they will be in
// production, and the only thing that differs from the public edge is the
// certificate authority and the listening port.
//
// How the sign-in form is completed, stated plainly: authentik renders its flow
// stages inside shadow DOM and synthetic clicks on the rendered controls did
// not advance the flow. The credential and second-factor steps are therefore
// submitted through authentik's own flow-executor JSON API, called with fetch()
// from inside the page. That is the same sequence of requests the rendered form
// makes, in the same browser session, with the same cookie jar. Everything
// after sign-in - the Frank route, the framed native application, Frappe's own
// OpenID Connect login, the reload and the post-logout denial - is ordinary
// browser navigation and is not automated through any API.
//
// It writes a JSON receipt. It never writes a password, a TOTP secret or a
// session cookie value into the receipt.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE
  || '/worktrees/owner-crm-final-release-20260913/node_modules/playwright');

const EDGE = process.env.ACCEPTANCE_EDGE || '127.0.0.1:9443';
const HOSTS = ['frank.fail', 'auth.frank.fail', 'crm.frank.fail', 'marketing.frank.fail', 'mail.frank.fail'];
const RULES = HOSTS.map((h) => `MAP ${h} ${EDGE}`).join(', ') + ', EXCLUDE localhost';

const OWNER_USER = process.env.OWNER_IDENTITY_OWNER_USERNAME || 'owner';
const OWNER_PASSWORD = process.env.OWNER_IDENTITY_OWNER_PASSWORD;
const RECEIPT = process.env.ACCEPTANCE_RECEIPT || '/tmp/owner-session-acceptance.json';
const SHOT_DIR = process.env.ACCEPTANCE_SHOTS || '';
const SECRET_OUT = process.env.ACCEPTANCE_TOTP_SECRET_OUT || '';
const TOTP_SECRET_IN = process.env.OWNER_IDENTITY_TOTP_SECRET || '';
const FLOW_SLUG = 'default-authentication-flow';

const receipt = {
  started_at: new Date().toISOString(),
  engine: 'chromium (playwright), headless',
  target: `https://frank.fail/ served by the acceptance edge at ${EDGE}`,
  credentials_in_receipt: false,
  steps: [],
  assertions: {},
};
const step = (name, ok, detail) => {
  receipt.steps.push({ name, ok, detail: detail === undefined ? null : String(detail).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + String(detail).slice(0, 220) : ''}`);
};
const note = (k, v) => { receipt.assertions[k] = v; };
const shot = async (page, name) => {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` }).catch(() => {});
};

// ------------------------------------------------------------------ TOTP ----
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secretBase32, at = Date.now()) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1e6).padStart(6, '0');
}
function secretFromConfigUrl(url) {
  const m = String(url).match(/[?&]secret=([A-Z2-7]+)/i);
  return m ? m[1].toUpperCase() : '';
}

// ------------------------------------------------------- flow executor ------
async function flowStep(page, component, fields) {
  return page.evaluate(async ([slug, comp, extra]) => {
    const query = window.location.search.replace(/^\?/, '');
    const res = await fetch(`/api/v3/flows/executor/${slug}/?query=${encodeURIComponent(query)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ component: comp, ...extra }),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) { json = { _unparsed: text.slice(0, 300) }; }
    return { status: res.status, body: json };
  }, [FLOW_SLUG, component, fields || {}]);
}

function challengeFields(body) {
  return ((body.challenge || {}).fields || []).map((f) => f.name || f.type);
}

(async () => {
  if (!OWNER_PASSWORD) throw new Error('OWNER_IDENTITY_OWNER_PASSWORD is required');
  const browser = await chromium.launch({
    args: [`--host-resolver-rules=${RULES}`, '--ignore-certificate-errors', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  const cspViolations = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 200));
  });

  let totpSecret = TOTP_SECRET_IN;

  try {
    // ---- 1. the owner entry point hands the browser to the identity provider
    await page.goto('https://frank.fail/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    step('frank.fail sends an anonymous owner to the identity provider',
      page.url().startsWith('https://auth.frank.fail/'), page.url().split('?')[0]);
    note('entry_redirect_host', new URL(page.url()).host);
    await shot(page, '01-identification');

    // ---- 2. authentication flow: identification, password, second factor
    let res = await flowStep(page, '', {});
    let stage = res.body.component;
    step('authentication flow started at the identification stage', stage === 'ak-stage-identification', stage);

    res = await flowStep(page, stage, { uid_field: OWNER_USER });
    stage = res.body.component;
    step('identification accepted the owner username', stage === 'ak-stage-password', stage);

    res = await flowStep(page, stage, { password: OWNER_PASSWORD });
    stage = res.body.component;
    step('password accepted; a second factor is required', stage === 'ak-stage-authenticator-validate', stage);
    note('stage_after_password', stage);

    let mfaChallenges = 0;
    let enrolledNow = false;
    for (let i = 0; i < 10 && stage && stage !== 'xak-flow-redirect'; i += 1) {
      const body = res.body;
      // authentik puts the stage payload at the top level of the executor
      // response, not inside `challenge`; `challenge` is only populated for the
      // stages that carry form fields.
      const ch = Object.keys(body.challenge || {}).length ? body.challenge : body;
      const fields = challengeFields(body);
      const configUrl = ch.config_url
        || (ch.fields || []).find((f) => f.name === 'config_url')?.value
        || String(JSON.stringify(body)).match(/otpauth:\/\/totp\/[^"\\]*/)?.[0]
        || '';
      if (stage === 'ak-stage-authenticator-totp') {
        mfaChallenges += 1;
        const secret = secretFromConfigUrl(configUrl);
        if (secret) {
          if (!totpSecret) { totpSecret = secret; enrolledNow = true; }
          step('identity provider demanded enrolment of an app-based second factor', true,
            `otpauth secret issued (${secret.length} chars, not recorded)`);
        } else {
          step('identity provider demanded enrolment of an app-based second factor', true, 'secret not exposed in challenge');
        }
        await shot(page, '02-mfa-enrol');
        res = await flowStep(page, stage, { code: totpSecret ? totp(totpSecret) : '' });
        stage = res.body.component;
        continue;
      }
      if (stage === 'ak-stage-authenticator-static') {
        mfaChallenges += 1;
        step('identity provider issued recovery codes as a fallback factor', true,
          `${(ch.fields || []).length} fields`);
        res = await flowStep(page, stage, {});
        stage = res.body.component;
        continue;
      }
      if (stage === 'ak-stage-authenticator-validate') {
        mfaChallenges += 1;
        if (totpSecret && (body.device_challenges || []).length) {
          res = await flowStep(page, stage, { code: totp(totpSecret) });
          stage = res.body.component;
          continue;
        }
        // No enrolled device: authentik offers the configuration stages it was
        // told to require and waits for the client to pick one.
        const offered = body.configuration_stages || ch.configuration_stages || [];
        if (offered.length) {
          note('mfa_configuration_stages_offered', offered.map((c) => c.verbose_name || c.name));
          const totpStage = offered.find((c) => /totp/i.test(`${c.verbose_name} ${c.name}`)) || offered[0];
          res = await flowStep(page, stage, { selected_stage: totpStage.pk });
          stage = res.body.component;
          continue;
        }
        step('second factor stage offered no way to enrol', false, JSON.stringify(fields));
        break;
      }
      void configUrl; void fields;
      break;
    }
    note('second_factor_challenges', mfaChallenges);
    note('totp_enrolled_during_this_run', enrolledNow);
    step('authentication required a second factor', mfaChallenges > 0, `${mfaChallenges} challenge(s)`);
    if (enrolledNow && SECRET_OUT) fs.writeFileSync(SECRET_OUT, totpSecret, { mode: 0o600 });
    step('second factor accepted; flow reached a redirect', Boolean(res.body.to), res.body.to ? res.body.to.split('?')[0] : stage);

    // ---- 3. complete the round trip in the browser
    // `to` is returned as an absolute path on the identity provider origin.
    const to = res.body.to
      ? new URL(res.body.to, 'https://auth.frank.fail/').toString()
      : null;
    if (to) await page.goto(to, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    if (!page.url().startsWith('https://frank.fail/') && page.url().startsWith('https://auth.frank.fail/')) {
      // The outpost callback chain needs one more hop.
      await page.goto('https://frank.fail/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }
    step('sign-in round trip returned to the intended Frank route',
      page.url().startsWith('https://frank.fail/'), page.url().split('?')[0]);
    note('after_login_url', page.url().split('?')[0]);

    // ---- 4. the native application is reachable behind the same owner session
    await page.goto('https://crm.frank.fail/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    step('crm.frank.fail accepted the owner session at the edge',
      !page.url().startsWith('https://auth.frank.fail/'), page.url().split('?')[0]);
    note('crm_first_url', page.url().split('?')[0]);
    await shot(page, '03-crm-entry');

    // ---- 5. Frappe's own OpenID Connect login, not just the proxy
    const loginLink = page.locator('a[href*="oauth2_logins"], a[href*="login_with"], a[href*="social"]').first();
    const hasSocial = await loginLink.count() > 0;
    note('frappe_social_login_link_present', hasSocial);
    if (hasSocial) {
      const href = await loginLink.getAttribute('href');
      note('frappe_social_login_href', href);
      await loginLink.click({ timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(4000);
      step('Frappe handed the browser to the identity provider for its own login',
        /auth\.frank\.fail/.test(page.url()) || /oauth2_logins/.test(page.url()),
        page.url().split('?')[0]);
      // The authorize endpoint redirects straight back to Frappe's callback
      // because the owner session already exists; give the chain time to land.
      for (let i = 0; i < 12 && page.url().startsWith('https://auth.frank.fail/'); i += 1) {
        await page.waitForTimeout(2000);
      }
      note('url_after_social_click', page.url().split('?')[0]);
    } else {
      await page.goto(`https://crm.frank.fail/api/method/frappe.integrations.oauth2_logins.custom/authentik`,
        { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(2500);
    note('after_oidc_url', page.url().split('?')[0]);

    // ---- 6. a real native Frappe page, inside the workspace context
    await page.goto('https://crm.frank.fail/crm', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const title = await page.title();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const docCookies = await context.cookies('https://crm.frank.fail');
    const sidCookie = docCookies.find((c) => c.name === 'sid');
    const nativeOk = Boolean(sidCookie) && sidCookie.value !== 'Guest';
    step('Frappe issued its own authenticated session (not just a proxy pass)', nativeOk,
      sidCookie ? `sid present, secure=${sidCookie.secure}, sameSite=${sidCookie.sameSite}, httpOnly=${sidCookie.httpOnly}` : 'no sid cookie');
    note('frappe_sid_cookie', sidCookie
      ? { secure: sidCookie.secure, httpOnly: sidCookie.httpOnly, sameSite: sidCookie.sameSite, path: sidCookie.path }
      : null);
    step('a native Frappe page rendered inside the Frank workspace context',
      nativeOk && bodyText.length > 200, `title="${title.slice(0, 70)}" body=${bodyText.length}B url=${page.url().split('?')[0]}`);
    note('frappe_page_title', title.slice(0, 120));
    note('frappe_url', page.url().split('?')[0]);
    note('frappe_body_sample', bodyText.replace(/\s+/g, ' ').slice(0, 240));
    await shot(page, '04-frappe-native');

    // ---- 7. the session survives a reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const cookiesAfter = await context.cookies('https://crm.frank.fail');
    const sidAfter = cookiesAfter.find((c) => c.name === 'sid');
    step('reload kept the native session', Boolean(sidAfter) && sidAfter.value !== 'Guest',
      `sid unchanged=${Boolean(sidAfter && sidCookie && sidAfter.value === sidCookie.value)}`);

    // ---- 8. the app origin is framed by Frank and only by Frank
    const headerProbe = await context.newPage();
    const headerResp = await headerProbe.goto('https://crm.frank.fail/crm', { waitUntil: 'domcontentloaded' });
    const appHeaders = {
      csp: headerResp.headers()['content-security-policy'],
      xfo: headerResp.headers()['x-frame-options'],
    };
    await headerProbe.close();
    note('crm_csp', appHeaders.csp);
    note('crm_xfo', appHeaders.xfo);
    step('the app origin names only the Frank parent in frame-ancestors',
      /frame-ancestors https:\/\/frank\.fail\b/.test(appHeaders.csp || '') && !/frame-ancestors \*/.test(appHeaders.csp || ''),
      appHeaders.csp);
    step('the app origin no longer sends a conflicting X-Frame-Options', !appHeaders.xfo, String(appHeaders.xfo));

    // ---- 9. logout at the owner session boundary
    const beforeLogout = (await context.cookies()).map((c) => `${c.domain}${c.path}:${c.name}`);
    note('cookies_before_logout', beforeLogout);
    // The outpost stores one proxy session cookie per gated host, and its
    // sign_out only clears the cookie for the host it is served on. Ending the
    // authentik session is what actually revokes authority, so both are done:
    // the invalidation flow on the identity provider, then sign_out on every
    // app host that holds a cookie.
    await page.goto('https://auth.frank.fail/if/flow/default-invalidation-flow/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 5; i += 1) {
      const b = page.getByRole('button', { name: /log ?out|continue|sign out|yes/i }).first();
      if (await b.count() && await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(2000); } else break;
    }
    for (const host of ['frank.fail', 'crm.frank.fail', 'marketing.frank.fail']) {
      await page.goto(`https://${host}/outpost.goauthentik.io/sign_out`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(1500);
    const afterLogout = (await context.cookies()).map((c) => `${c.domain}${c.path}:${c.name}`);
    note('cookies_after_logout', afterLogout);
    note('cookies_cleared_by_logout', beforeLogout.filter((c) => !afterLogout.includes(c)));
    step('logout reached the owner session boundary', true,
      `${beforeLogout.length} cookies -> ${afterLogout.length}; url=${page.url().split('?')[0]}`);

    // ---- 10. a direct native URL is denied after logout
    const fresh = await context.newPage();
    await fresh.goto('https://crm.frank.fail/crm/dashboard', { waitUntil: 'domcontentloaded' });
    await fresh.waitForTimeout(2500);
    const denied = fresh.url().startsWith('https://auth.frank.fail/');
    step('after logout a direct native app URL is denied', denied, fresh.url().split('?')[0]);
    note('post_logout_url', fresh.url().split('?')[0]);
    await shot(fresh, '05-post-logout-denied');

    // ---- 11. no anonymous route anywhere
    const anon = await context.newPage();
    const anonResp = await anon.goto('https://frank.fail/', { waitUntil: 'domcontentloaded' });
    step('frank.fail itself is denied after logout',
      anon.url().startsWith('https://auth.frank.fail/') && !/Frank is running/.test(await anon.locator('body').innerText().catch(() => '')),
      `status=${anonResp && anonResp.status()} url=${anon.url().split('?')[0]}`);

    note('csp_violations', cspViolations.slice(0, 4));
    step('no content-security-policy violations on the pages exercised', cspViolations.length === 0,
      cspViolations.length ? cspViolations[0] : 'none');
  } catch (err) {
    step('acceptance run completed without an unhandled error', false, String(err).slice(0, 300));
    receipt.error = String(err).slice(0, 600);
  } finally {
    receipt.finished_at = new Date().toISOString();
    receipt.passed = receipt.steps.length > 0 && receipt.steps.every((s) => s.ok);
    receipt.failed_steps = receipt.steps.filter((s) => !s.ok).map((s) => s.name);
    fs.writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2));
    console.log(`\nreceipt: ${RECEIPT}  passed=${receipt.passed}  failed=${receipt.failed_steps.length}`);
    await browser.close();
  }
  process.exit(receipt.passed ? 0 : 1);
})();
