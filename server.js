// server.js
// API بسيط بـ Express عشان n8n يناديه

const express = require('express');
const { scrapePart, getBrowser } = require('./scraper');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
// مفتاح حماية بسيط عشان حدا تاني ما يستخدم الـ API
const API_KEY = process.env.API_KEY || '';

// Middleware للتحقق من المفتاح
function auth(req, res, next) {
  if (!API_KEY) return next(); // لو ما في مفتاح، نسمح (للتجربة)
  const key = req.header('x-api-key');
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// فحص صحة الخدمة
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'partsouq-scraper', time: new Date().toISOString() });
});

// نقطة الكشط الرئيسية
// POST /scrape  { "vin": "...", "partName": "oil filter" }
app.post('/scrape', auth, async (req, res) => {
  const { vin, partName } = req.body || {};

  if (!vin || !partName) {
    return res
      .status(400)
      .json({ success: false, error: 'لازم ترسل vin و partName' });
  }
  if (String(vin).replace(/\s/g, '').length !== 17) {
    return res.status(400).json({
      success: false,
      error: 'الـ VIN لازم يكون 17 خانة',
    });
  }

  try {
    const data = await scrapePart(String(vin).trim(), String(partName).trim());
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, async () => {
  console.log(`partsouq-scraper شغّال على بورت ${PORT}`);
  // نسخّن المتصفح من البداية عشان أول طلب يكون أسرع
  try {
    await getBrowser();
    console.log('المتصفح جاهز');
  } catch (e) {
    console.error('فشل تشغيل المتصفح:', e.message);
  }
});
