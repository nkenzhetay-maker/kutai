# KutAI — Deploy Talimatları

## Dosya Yapısı
```
kutai/
├── index.html                  ← Ana uygulama
├── netlify.toml                ← Netlify config
├── netlify/
│   └── functions/
│       └── kutai.js            ← Claude API proxy (güvenli)
└── README.md
```

## 1. GitHub'a Yükle
```
git init
git add .
git commit -m "KutAI v1.0"
git remote add origin https://github.com/KULLANICI/kutai.git
git push -u origin main
```

## 2. Netlify'da Yeni Site
- netlify.com → "Add new site" → "Import from Git"
- Repo seç → Deploy

## 3. Environment Variable (ZORUNLU)
Netlify Dashboard → Site Settings → Environment Variables:
```
ANTHROPIC_API_KEY = sk-ant-...
```

## 4. index.html İçinde Güncellenecek 3 Şey

### EmailJS (satır ~165):
```javascript
emailjs.init("YOUR_EMAILJS_PUBLIC_KEY");     // ← EmailJS Public Key
const EMAILJS_SERVICE  = "YOUR_SERVICE_ID";  // ← Service ID
const EMAILJS_TEMPLATE = "YOUR_TEMPLATE_ID"; // ← Template ID
```
trtrussianqa.netlify.app ile aynı değerleri kullanabilirsin.

### EmailJS Template'i Kontrol Et:
Template'de şu değişkenler kullanılıyor:
- `{{to_email}}` — alıcı email
- `{{otp_code}}` — 6 haneli kod
- `{{product_name}}` — "KutAI"

### İzinli Email Listesi (satır ~167):
```javascript
const ALLOWED_EMAILS = [
  "ornek@trt.net.tr",
  "diger@trt.net.tr",
  // Buraya ekle...
];
```

## 5. Deploy Sonrası Test
1. Siteyi aç
2. İzinli bir email gir → OTP al → giriş yap
3. "Написать" sekmesinde kısa bir brief gir → test et

## Maliyet Tahmini
| Servis | Ücret |
|--------|-------|
| Netlify Pro (mevcut) | $0 (ek yok) |
| Claude Haiku API | ~$1-3/ay |
| EmailJS (mevcut) | $0 (ek yok) |

## Sorun Giderme
- **504 timeout:** kutai.js'de maxTokens'ı düşür (1000'e)
- **CORS hatası:** netlify.toml'daki headers'ı kontrol et
- **OTP gelmiyor:** EmailJS template değişken adlarını kontrol et
