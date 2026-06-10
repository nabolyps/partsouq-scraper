// scraper.js — يبحث داخل كتالوج البارت سوق ويطلّع رقم القطعة
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const NAV_TIMEOUT = 45000;
const BASE = 'https://partsouq.com';
const log = (...a) => console.log('[scraper]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--window-size=1366,768'],
    });
  }
  return browserPromise;
}
async function newPage() {
  const b = await getBrowser();
  const p = await b.newPage();
  await p.setUserAgent(UA);
  await p.setViewport({ width: 1366, height: 768 });
  await p.setDefaultNavigationTimeout(NAV_TIMEOUT);
  await p.setRequestInterception(true);
  p.on('request', (r) => {
    const t = r.resourceType();
    if (t === 'image' || t === 'font' || t === 'media') r.abort();
    else r.continue();
  });
  return p;
}

async function scrapePart(vin, partName) {
  const page = await newPage();
  const result = { success: false, vin, partName, vehicle: null, results: [], error: null, debug: {} };
  try {
    await page.goto(`${BASE}/search/vin?vin=${encodeURIComponent(vin)}`, { waitUntil: 'domcontentloaded' }).catch((e) => log('goto', e.message));
    await sleep(3500);
    let title = await page.title().catch(() => '');
    result.vehicle = (title || '').slice(0, 120);
    log('catalog title:', title);

    // اضغط تبويب SEARCH
    const tab = await page.evaluate(() => {
      const e = Array.from(document.querySelectorAll('a,button,li,span,div'))
        .find((x) => x.textContent && x.textContent.trim().toUpperCase() === 'SEARCH' && (x.offsetWidth || x.offsetHeight));
      if (e) { e.click(); return true; }
      return false;
    }).catch(() => false);
    await sleep(1500);

    // اكتب اسم القطعة بصندوق البحث وأرسل
    const typed = await page.evaluate((pn) => {
      const inp = Array.from(document.querySelectorAll('input'))
        .find((i) => (i.type === 'text' || i.type === 'search' || !i.type) && (i.offsetWidth || i.offsetHeight));
      if (!inp) return false;
      inp.focus(); inp.value = pn;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      const f = inp.closest('form');
      if (f) { try { f.requestSubmit ? f.requestSubmit() : f.submit(); } catch (e) {} }
      return true;
    }, partName).catch(() => false);
    await page.keyboard.press('Enter').catch(() => {});
    await sleep(4500);

    // افتح الدياجرام الي اسمه يطابق القطعة
    const opened = await page.evaluate((pn) => {
      const want = pn.toLowerCase().split(/\s+/);
      let best = null, score = 0;
      Array.from(document.querySelectorAll('a')).forEach((a) => {
        if (!(a.offsetWidth || a.offsetHeight) || !a.textContent) return;
        const t = a.textContent.toLowerCase();
        const s = want.reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);
        if (s > score) { score = s; best = a; }
      });
      if (best && score > 0) { best.click(); return best.textContent.trim().slice(0, 80); }
      return null;
    }, partName).catch(() => null);
    await sleep(4000);

    // اجمع أرقام القطع (8 خانات فأكثر، أغلبها أرقام)
    const found = await page.evaluate(() => {
      const out = [];
      Array.from(document.querySelectorAll('tr,li,td,a,div,span')).forEach((b) => {
        const txt = (b.innerText || '').trim();
        if (!txt || txt.length > 160) return;
        const m = txt.match(/\b\d{4,6}[-]?\d{3,6}[-]?\d{0,4}\b/g);
        if (m) m.forEach((pn) => { if (pn.replace(/\D/g, '').length >= 8) out.push({ partNumber: pn, context: txt.replace(/\s+/g, ' ').slice(0, 90) }); });
      });
      return out;
    }).catch(() => []);

    const seen = new Set();
    result.results = found.filter((r) => { const k = r.partNumber.replace(/\D/g, ''); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
    result.success = result.results.length > 0;
    if (!result.success) {
      result.error = `ما لقيت أرقام. (SEARCH:${tab ? '✓' : '✗'} كتابة:${typed ? '✓' : '✗'} دياجرام:${opened || 'لا'})`;
    }
  } catch (err) {
    result.error = 'خطأ: ' + err.message;
    log('ERR', err.message);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}
module.exports = { scrapePart, getBrowser };
