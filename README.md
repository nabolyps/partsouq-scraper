# PartSouq Scraper API (لـ n8n)

خدمة صغيرة بتاخد **رقم الشاصي (VIN)** و **اسم القطعة**، بتكشط موقع partsouq.com عن طريق Puppeteer (مع تخطّي Cloudflare)، وبترجّع **رقم/أرقام القطعة (OEM)**.

هاي الخدمة بتنرفع على **Railway** وn8n بيناديها كـ API.

---

## 1) شو في بالباكج

```
partsouq-scraper/
├── server.js        # الـ API (Express)
├── scraper.js       # منطق الكشط (Puppeteer + Stealth)
├── package.json
├── Dockerfile       # عشان الكروم يشتغل على Railway
├── .env.example
└── .gitignore
```

## 2) النقطة (Endpoint)

```
POST /scrape
Headers:  x-api-key: <نفس المفتاح الي حطّيته>
Body (JSON):
{
  "vin": "JTDGG20W00J006109",
  "partName": "oil filter"
}
```

الرد:
```json
{
  "success": true,
  "vin": "JTDGG20W00J006109",
  "partName": "oil filter",
  "vehicle": "Toyota ...",
  "results": [
    { "partNumber": "9091510003", "context": "FILTER SUB ASSY ..." }
  ]
}
```

> ملاحظة مهمة: اسم القطعة لازم يكون **بالإنجليزي** لأنه كتالوج البارت سوق إنجليزي. n8n رح يترجمه تلقائيًا بالـ AI قبل ما يبعت (شرحته بآخر الملف).

## 3) النشر على Railway — خطوة بخطوة

1. ارفع المجلد على GitHub (repo جديد).
2. ادخل على [railway.app](https://railway.app) ← **New Project** ← **Deploy from GitHub repo** ← اختار الـ repo.
3. Railway رح يكتشف الـ `Dockerfile` تلقائيًا ويبني الخدمة.
4. روح على **Variables** وحط:
   - `API_KEY` = أي نص سري قوي (احفظه، بدك ياه بـ n8n)
5. بعد ما يخلص الـ Deploy، روح على **Settings ← Networking ← Generate Domain** عشان ياخد رابط عام مثل:
   ```
   https://partsouq-scraper-production.up.railway.app
   ```
6. جرّبه: افتح الرابط بالمتصفح، لازم يرجّعلك `{ "ok": true ... }`.

## 4) ربطه مع n8n

بـ workflow الـ n8n (الي عامله إلك) في نود **HTTP Request** معبّى هيك:
- Method: `POST`
- URL: `https://رابط-Railway/scrape`
- Header: `x-api-key` = نفس الـ `API_KEY`
- Body (JSON): `{ "vin": "{{ $json.vin }}", "partName": "{{ $json.partName }}" }`

كل الي بدك تعمله: تبدّل الـ URL والمفتاح بقيمك.

---

## ⚠️ ملاحظات صريحة (لازم تعرفها)

1. **Cloudflare متغيّر**: ساعات بيعدّي عادي، وساعات بشدّد. لو فشل، أول إشي جرّب تزيد `NAV_TIMEOUT` بـ `scraper.js`. لو ظل يحجب، بنحكي عن إضافة بروكسي.

2. **الـ Selectors بحاجة معايرة**: البارت سوق ممكن يغيّر شكل الصفحة. لو رجّع `results` فاضية، الرد بيجيب `debug.screenshot` (Base64) — افتحها وشوف وين وقف، وعدّل الـ selectors بـ `scraper.js` (مكتوبة ومعلّمة بالعربي).

3. **اسم القطعة إنجليزي**: لأنه الكتالوج إنجليزي. n8n بيترجم تلقائيًا.

4. **النتائج مرشّحين**: السكريبت بيرجّع كل الأرقام المحتملة، وn8n/الـ AI بيختار الأنسب ويرتّبها للعميل.
