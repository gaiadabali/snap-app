// Phone screenshots from the Expo web build, as seeded demo people (staging only).
//   PLAYWRIGHT=/path/to/node_modules/playwright node capture-phone.cjs <demo receipt jpg>
// 360x640 CSS px at deviceScaleFactor 3 gives 1080x1920. Output goes to ../phone/.
// Sign-in uses POST /v1/auth/google-simulator/sign-in, which only admits the seeded demo people.
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const APP = 'https://snap-apps-app.gaiada.com';
const API = 'https://snap-apps-api.gaiada.com';
const OUT = path.join(__dirname, '..', 'phone');
const RECEIPT = process.argv[2]; // synthetic receipt, already uploaded once as Sam (see README)

async function session(browser, email) {
  const r = await fetch(`${API}/v1/auth/google-simulator/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error(`sign-in ${email}: ${r.status}`);
  const { token } = await r.json();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-AU', timezoneId: 'Australia/Sydney', permissions: ['camera'] });
  await ctx.addInitScript((t) => { try { localStorage.setItem('snap.auth.token', t); } catch {} }, token);
  return ctx.newPage();
}
const settle = (p) => p.waitForLoadState('networkidle').then(() => p.waitForTimeout(2500));
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name) });

(async () => {
  const browser = await chromium.launch();
  const kate = await session(browser, 'kate@marshtransport.example');
  const sam = await session(browser, 'sam@marshtransport.example');

  await kate.goto(APP, { waitUntil: 'networkidle' }); await settle(kate);
  await shot(kate, '1-home.png');

  // The web build has no camera (placeholder text). Put the receipt where the live feed would be.
  await sam.goto(`${APP}/capture`, { waitUntil: 'networkidle' }); await settle(sam);
  const b64 = require('fs').readFileSync(RECEIPT).toString('base64');
  await sam.evaluate((img) => {
    const hide = () => {
      const t = [...document.querySelectorAll('div')].find((e) => e.children.length === 0 && /No camera in a browser/.test(e.textContent || ''));
      if (!t) return;
      t.style.color = 'transparent';
      const box = t.parentElement;
      box.style.backgroundColor = '#161616';
      box.style.backgroundRepeat = 'no-repeat';
      box.style.backgroundImage = `linear-gradient(to bottom, rgba(0,0,0,.6) 0, rgba(0,0,0,0) 110px, rgba(0,0,0,0) 330px, rgba(0,0,0,.75) 420px), url(data:image/jpeg;base64,${img})`;
      box.style.backgroundSize = '100% 100%, 84% auto';
      box.style.backgroundPosition = '0 0, center 96px';
    };
    hide(); setInterval(hide, 200);
  }, b64);
  await sam.waitForTimeout(600);
  await shot(sam, '2-scan.png');

  // The read receipt (uploaded once as Sam). Top of the page, then the checks.
  await sam.goto(`${APP}/receipts`, { waitUntil: 'networkidle' }); await settle(sam);
  await sam.getByText('HARBOUR ST COFFEE').first().click(); await settle(sam);
  await shot(sam, '3-receipt.png');
  await sam.getByText('What was on it', { exact: true }).first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await sam.waitForTimeout(600);
  await shot(sam, '4-receipt-lines.png');

  await kate.goto(`${APP}/budgets`, { waitUntil: 'networkidle' }); await settle(kate);
  await shot(kate, '5-budgets.png');

  await kate.goto(APP, { waitUntil: 'networkidle' }); await settle(kate);
  await kate.getByText('Menu', { exact: true }).last().click(); await kate.waitForTimeout(1500);
  await shot(kate, '6-menu.png');

  await kate.goto(`${APP}/credits`, { waitUntil: 'networkidle' }); await settle(kate);
  await shot(kate, '7-credits.png');

  await browser.close();
})();
