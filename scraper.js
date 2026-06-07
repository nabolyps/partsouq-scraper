// scraper.js
// منطق الكشط الأساسي للبارت سوق باستخدام Puppeteer + Stealth
// المهمة: ياخد VIN + اسم القطعة -> يرجّع رقم/أرقام القطعة (OEM)

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// إعدادات عامة
const NAV_TIMEOUT = 60000; // 60 ثانية لكل تنقّل (Cloudflare بياخد وقت)
const BASE = 'https://partsouq.com';

let browserPromise = null;

// نفتح متصفح واحد ونعيد استخدامه (أسرع وأخف على Railway)
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
  // نخفّف التحميل: نوقف الصور/الخطوط لتسريع الكشط
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (type === 'image' || type === 'font' || type === 'media') {
      req.abort();
    } else {
      req.continue();
    }
  });
  return page;
}

// ننتظر لين يعدّي تحدّي Cloudflare (لو ظهر)
async function passCloudflare(page) {
  try {
    // لو في عنصر التحقق، ننتظر شوي لين يخلص
    await page.waitForFunction(
      () => !document.title.toLowerCase().includes('just a moment'),
      { timeout: NAV_TIMEOUT }
    );
  } catch (e) {
    // نكمّل برضه، ممكن يكون عدّى
  }
}

/**
 * الدالة الرئيسية
 * @param {string} vin - رقم الشاصي (17 خانة)
 * @param {string} partName - اسم القطعة بالإنجليزي (مثلاً "oil filter")
 * @returns {Promise<object>}
 */
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
    // (1) فتح كتالوج السيارة عن طريق الـ VIN
    const vinUrl = `${BASE}/search/vin?vin=${encodeURIComponent(vin)}`;
    await page.goto(vinUrl, { waitUntil: 'domcontentloaded' });
    await passCloudflare(page);

    // ننتظر لين يحمّل محتوى الكتالوج
    await page
      .waitForSelector('body', { timeout: NAV_TIMEOUT })
      .catch(() => {});

    // نحاول نقرأ اسم السيارة لو ظاهر (للتأكيد فقط)
    result.vehicle = await page
      .evaluate(() => {
        const h = document.querySelector('h1, .vehicle-title, .breadcrumb');
        return h ? h.innerText.trim().slice(0, 200) : null;
      })
      .catch(() => null);

    // (2) البحث داخل الكتالوج باسم القطعة
    // البارت سوق فيه صندوق بحث داخل الكتالوج. نجرّب أكثر من selector احتياطًا.
    const searchSelectors = [
      'input[name="q"]',
      'input[type="search"]',
      'input.form-control[placeholder]',
      '#search-input',
    ];

    let searchBox = null;
    for (const sel of searchSelectors) {
      searchBox = await page.$(sel);
      if (searchBox) {
        result.debug.searchSelectorUsed = sel;
        break;
      }
    }

    if (searchBox) {
      await searchBox.click({ clickCount: 3 });
      await searchBox.type(partName, { delay: 40 });
      await page.keyboard.press('Enter');
      await page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
        .catch(() => {});
      await passCloudflare(page);
    } else {
      // احتياط: لو ما لقينا صندوق البحث، نجرّب رابط البحث المباشر داخل الكتالوج
      const directSearch = `${BASE}/search/all?q=${encodeURIComponent(partName)}`;
      await page.goto(directSearch, { waitUntil: 'domcontentloaded' });
      await passCloudflare(page);
      result.debug.usedDirectSearch = true;
    }

    // (3) استخراج النتائج: أي جداول أو روابط فيها أرقام قطع
    // أرقام القطع عادةً 8-13 خانة (حروف+أرقام). نجمع المرشّحين.
    const scraped = await page.evaluate(() => {
      const out = [];

      // نلمّ من الجداول
      document.querySelectorAll('table tr').forEach((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((td) =>
          td.innerText.trim()
        );
        if (cells.length) {
          const joined = cells.join(' | ');
          const m = joined.match(/\b[A-Z0-9]{6,15}\b/g);
          if (m) {
            out.push({ partNumber: m[0], context: joined.slice(0, 160) });
          }
        }
      });

      // نلمّ من الروابط (أسماء الدياجرامات / القطع)
      document.querySelectorAll('a').forEach((a) => {
        const t = a.innerText.trim();
        const href = a.getAttribute('href') || '';
        const m = t.match(/\b[A-Z0-9]{6,15}\b/);
        if (m && t.length < 80) {
          out.push({ partNumber: m[0], context: t, href });
        }
      });

      return out;
    });

    // تنظيف وإزالة التكرار
    const seen = new Set();
    result.results = scraped.filter((r) => {
      if (seen.has(r.partNumber)) return false;
      seen.add(r.partNumber);
      return true;
    });

    result.success = result.results.length > 0;
    if (!result.success) {
      result.error = 'ما لقينا أرقام قطع — على الأغلب الـ selectors بحاجة تعديل أو Cloudflare حجب.';
      // نحفظ لقطة شاشة للديباغ
      result.debug.screenshot = await page
        .screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 })
        .catch(() => null);
      result.debug.pageTitle = await page.title().catch(() => null);
    }
  } catch (err) {
    result.error = err.message;
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

module.exports = { scrapePart, getBrowser };
