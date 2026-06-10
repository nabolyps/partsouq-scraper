// scraper.js  (نسخة تشخيصية — تطبع تفاصيل كتير باللوقز عشان نعاير)
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const NAV_TIMEOUT = 45000;
const BASE = 'https://partsouq.com';

function log(...args) {
  console.log('[scraper]', ...args);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1366,768',
      ],
    });
  }
  return browserPromise;
}

async function newPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1366, height: 768 });
  await page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (type === 'image' || type === 'font' || type === 'media') req.abort();
    else req.continue();
  });
  return page;
}

async function scrapePart(vin, partName) {
  const page = await newPage();
  const result = {
    success: false,
    vin,
    partName,
    vehicle: null,
    results: [],
    error: null,
    debug: {},
  };

  try {
    const vinUrl = `${BASE}/search/vin?vin=${encodeURIComponent(vin)}`;
    log('1) Navigating to:', vinUrl);
    await page.goto(vinUrl, { waitUntil: 'domcontentloaded' }).catch((e) => {
      log('goto error (continuing):', e.message);
    });
    await sleep(3000);

    let title = await page.title().catch(() => '');
    const url = page.url();
    log('2) After VIN nav -> title:', title, '| url:', url);

    let bodyText = await page
      .evaluate(() => (document.body ? document.body.innerText : ''))
      .catch(() => '');
    log('3) Body snippet:', bodyText.replace(/\s+/g, ' ').slice(0, 350));

    if (/just a moment|verify you are human|checking your browser|cloudflare|attention required/i
        .test(title + ' ' + bodyText)) {
      log('!! Cloudflare challenge detected. Waiting 8s...');
      await sleep(8000);
      title = await page.title().catch(() => '');
      bodyText = await page
        .evaluate(() => (document.body ? document.body.innerText : ''))
        .catch(() => '');
      log('4) After CF wait -> title:', title);
      log('5) Body snippet now:', bodyText.replace(/\s+/g, ' ').slice(0, 350));
    }

    result.debug.title = title;
    result.debug.url = page.url();

    const inputs = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll('input')).map((i) => ({
          name: i.getAttribute('name'),
          type: i.getAttribute('type'),
          placeholder: i.getAttribute('placeholder'),
          id: i.id || null,
          cls: (i.className || '').slice(0, 40),
          visible: !!(i.offsetWidth || i.offsetHeight),
        }))
      )
      .catch(() => []);
    log('6) Inputs on page:', JSON.stringify(inputs));

    const linkCount = await page
      .evaluate(() => document.querySelectorAll('a').length)
      .catch(() => 0);
    const tableRows = await page
      .evaluate(() => document.querySelectorAll('table tr').length)
      .catch(() => 0);
    log('7) Links:', linkCount, '| table rows:', tableRows);

    const scraped = await page
      .evaluate(() => {
        const out = [];
        document.querySelectorAll('table tr').forEach((row) => {
          const cells = Array.from(row.querySelectorAll('td')).map((td) =>
            td.innerText.trim()
          );
          if (cells.length) {
            const joined = cells.join(' | ');
            const m = joined.match(/\b[A-Z0-9]{6,15}\b/g);
            if (m) out.push({ partNumber: m[0], context: joined.slice(0, 140) });
          }
        });
        return out;
      })
      .catch(() => []);

    const seen = new Set();
    result.results = scraped.filter((r) => {
      if (seen.has(r.partNumber)) return false;
      seen.add(r.partNumber);
      return true;
    });
    log('8) Part numbers found directly:', result.results.length);

    result.success = result.results.length > 0;
    if (!result.success) {
      result.error =
        'ما لقينا أرقام مباشرة. شوف اللوقز (title/body/inputs) عشان نعاير الـ selectors.';
      log('9) No direct results. title=', title, '| inputsCount=', inputs.length);
    } else {
      log('9) SUCCESS. First:', JSON.stringify(result.results[0]));
    }
  } catch (err) {
    result.error = err.message;
    log('ERROR (caught):', err.message);
    try {
      const t = await page.title();
      const b = await page.evaluate(() =>
        document.body ? document.body.innerText.slice(0, 300) : ''
      );
      log('ERROR page title:', t, '| body:', (b || '').replace(/\s+/g, ' '));
      result.debug.title = t;
    } catch (e) {}
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

module.exports = { scrapePart, getBrowser };
