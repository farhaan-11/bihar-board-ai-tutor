# SEO Implementation Plan — learnzuno.in

> Final Audited Version — 6 August 2026
> Branch: `seo-work`

---

## Problem

`learnzuno.in` abhi Google pe exist nahi karta. `site:learnzuno.in` search karo — zero results aata hai.

3 cheezein ek saath galat hain:
1. React SPA hone ki wajah se Google ko actual content nahi dikhta (sirf khali `<div id="root"></div>`)
2. Google ko is site ke baare mein officially bataya hi nahi gaya (no Search Console, no sitemap)
3. Jo thoda HTML Google ko milta bhi hai, usme keyword ya relevant info nahi hai (title sirf "Zuno")

## Goal

Jab koi Google pe `learn zuno`, `zuno ai tutor`, `bihar board class 10 science hindi` ya similar keywords search kare, toh `learnzuno.in` result mein aaye.

---

## Full Audit Findings

| Cheez | Abhi Kya Hai | Status |
|-------|-------------|--------|
| **Title tag** | Sirf `"Zuno"` — Google ko kuch samajh nahi aata | ❌ Bad |
| **Meta description** | Generic English description | ⚠️ Weak |
| **Language attribute** | `lang="en"` — content Hindi/Hinglish hai | ⚠️ Wrong |
| **Canonical URL** | Nahi hai | ❌ Missing |
| **robots.txt** | File exist hi nahi karti | ❌ Missing |
| **sitemap.xml** | File exist hi nahi karti | ❌ Missing |
| **Open Graph tags** | Koi nahi — WhatsApp/Telegram share mein kuch nahi dikhega | ❌ Missing |
| **Twitter Card tags** | Koi nahi | ❌ Missing |
| **Structured Data (Schema.org)** | Nahi hai | ❌ Missing |
| **Per-page titles** | Har page pe same "Zuno" title hai | ❌ Bad |
| **H1 heading** | Landing page mein koi `<h1>` tag nahi — sirf `<div>` hai | ❌ Missing |
| **noindex on auth pages** | Login/Register/Verify pages Google ko bhi dikhti hain — waste | ❌ Missing |
| **noscript fallback** | JS disabled hone pe kuch nahi dikhta | ❌ Missing |
| **Google Search Console** | Registered nahi hai | ❌ Not done |
| **Google Analytics** | Nahi hai — traffic ka koi data nahi milega | ❌ Missing |
| **Pre-rendering / SSG** | Nahi hai — Google ko khali HTML milta hai | ❌ Missing |
| **OG Image** | Nahi hai — social share pe koi image nahi dikhti | ❌ Missing |
| **Vercel trailing slash** | Configured nahi — duplicate URLs ban sakte hain | ⚠️ Not set |
| **Favicons** | SVG + PNG + Apple Touch Icon sab hain | ✅ Good |
| **Fonts** | Inter, Baloo 2, JetBrains Mono — sab load ho rahe hain | ✅ Good |
| **Vercel deployment** | Working with SPA rewrites | ✅ Good |
| **HTTPS** | Haan — `https://learnzuno.in` | ✅ Good |
| **Clean URLs** | `/chat`, `/support` — sab clean hain | ✅ Good |
| **Image alt tags** | Koi `<img>` tag hi nahi hai app mein — N/A | ✅ N/A |

---

## Phases Overview

| Phase | Kya | Time | Kaun |
|-------|-----|------|------|
| 1 | index.html complete makeover | 45 min | AI |
| 2 | robots.txt + automatic sitemap.xml | 30 min | AI |
| 3 | Per-page SEO (react-helmet-async) | 2-3 hrs | AI |
| 4 | Landing page H1 heading fix | 15 min | AI |
| 5 | OG Image banao | 30 min | AI |
| 6 | Pre-rendering (public pages) | 3-4 hrs | AI |
| 7 | Google Analytics 4 setup | 30 min | Dono |
| 8 | Vercel config (headers + trailing slash) | 15 min | AI |
| 9 | Google Search Console registration | 30 min | User (AI guides) |
| 10 | Deploy + Test + Verify | 1 hr | Dono |
| **Total one-time:** | | **~10-12 hrs** | |

---

## Phase 1 — index.html Complete Makeover

**Time: 45 min | Kaun: AI**

Ye tumhari site ka foundation hai. Google kisi bhi page pe aaye, pehle ye HTML padhta hai. Abhi ye bahut kamzor hai.

### Kya kya fix hoga:

**1. Title tag**
- Abhi: `<title>Zuno</title>`
- Baad: `<title>Zuno — Bihar Board Class 10 Science AI Tutor | Hindi Mein Padho</title>`
- Kyun: Google title dekh ke decide karta hai page kiske baare mein hai. Keywords title mein hone chahiye.

**2. Meta description**
- Abhi: Generic English description
- Baad: Keyword-rich description with "Bihar Board", "Class 10", "Science", "Hinglish", "Physics", "Chemistry", "Biology"
- Kyun: Google search result mein title ke neeche ye description dikhti hai. Achhi description = zyada click.

**3. Language attribute**
- Abhi: `lang="en"`
- Baad: `lang="hi"`
- Kyun: Content Hindi/Hinglish hai. Google ko batana padta hai correct language — isse Hindi search results mein better rank milta hai.

**4. Canonical URL**
- Add: `<link rel="canonical" href="https://learnzuno.in/" />`
- Kyun: Agar koi `www.learnzuno.in` ya `learnzuno.in/` ya `learnzuno.in` se aaye — Google confused na ho. Canonical batata hai "ye hai official URL."

**5. Open Graph tags**
- Add: `og:title`, `og:description`, `og:url`, `og:type`, `og:image`, `og:site_name`, `og:locale`
- Kyun: Jab koi tumhara link WhatsApp, Telegram, Instagram, Facebook pe share karega — toh ek achha card dikhega (title + image + description). Abhi kuch nahi dikhta.

**6. Twitter/X Card tags**
- Add: `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`
- Kyun: Same as OG but specifically Twitter/X ke liye.

**7. Structured Data (JSON-LD)**
- Add: Schema.org `EducationalOrganization` + `WebApplication`
- Kyun: Google ko extra structured info deta hai. Google kabhi kabhi isse "rich snippets" banata hai — search result mein tumhara entry zyada detailed aur attractive dikhta hai.

**8. noscript fallback**
- Add: `<noscript>` tag with basic text content inside `<div id="root">`
- Kyun: Agar kisi crawler ya user ke browser mein JavaScript disabled hai, toh use bilkul blank page nahi dikhega — kam se kam ek basic message dikhega with keywords.

**9. Google Search Console verification meta tag**
- Add: `<meta name="google-site-verification" content="..." />`
- Kyun: Phase 9 mein Search Console register karenge. Us waqt Google ek code dega — usse yahan paste karenge. Abhi placeholder rakh denge.

### File:
- `frontend/index.html` — MODIFY

---

## Phase 2 — robots.txt + Automatic Sitemap Generation

**Time: 30 min | Kaun: AI**

### robots.txt
- Ye ek chhoti file hai jo Google ke robot ko instructions deti hai.
- "Haan bhai, meri site crawl karo" aur "Sitemap yahan hai"

Content:
```
User-agent: *
Allow: /
Disallow: /auth/
Disallow: /verify-email
Disallow: /forgot-password
Disallow: /reset-password

Sitemap: https://learnzuno.in/sitemap.xml
```

Note: `/login` aur `/register` ko Disallow nahi karenge — unhe noindex se handle karenge (Phase 3 mein). Disallow se Google un pages ko dekhega hi nahi, lekin humein unpe noindex tag lagana hai taaki agar koi aur site se link aaye toh bhi Google index na kare.

### sitemap.xml (Automatic via vite-plugin-sitemap)
- `vite-plugin-sitemap` install karenge
- Vite config mein configure karenge
- Har baar `vite build` run hoga, fresh sitemap automatically ban jaayega
- Manually maintain karne ki zaroorat nahi

Sitemap mein ye pages jayenge:
| URL | Priority | Change Frequency |
|-----|----------|-----------------|
| `https://learnzuno.in/` | 1.0 | weekly |
| `https://learnzuno.in/chat` | 0.8 | weekly |
| `https://learnzuno.in/support` | 0.5 | monthly |

Ye pages sitemap mein NAHI jayenge:
- `/login`, `/register` — Auth pages
- `/auth/callback` — Internal OAuth flow
- `/verify-email`, `/forgot-password`, `/reset-password` — Internal flows

### Files:
- `frontend/public/robots.txt` — NEW
- `frontend/vite.config.js` — MODIFY (sitemap plugin add)
- `frontend/package.json` — MODIFY (vite-plugin-sitemap dependency)

---

## Phase 3 — Per-Page SEO (Dynamic Meta Tags)

**Time: 2-3 hrs | Kaun: AI**

Abhi tumhare site pe har page ka title same hai — "Zuno". Chahe user Landing pe ho ya Chat pe ya Support pe. Ye galat hai.

### Approach
- `react-helmet-async` package install karenge
- `HelmetProvider` wrapper add karenge `main.jsx` mein
- Har page mein `<Helmet>` component se unique title, description, canonical URL set hoga

### Per-page SEO content:

**Landing Page (`/`)**
- Title: `Zuno — Bihar Board Class 10 Science AI Tutor | Hindi Mein Padho`
- Description: `Zuno AI Tutor se Bihar Board Class 10 Science ke doubts poochho — Hindi aur Hinglish mein. Physics, Chemistry, Biology — sab kuch Bihar Board syllabus se grounded jawab.`
- Canonical: `https://learnzuno.in/`

**Chat Page (`/chat`)**
- Title: `Apna Sawaal Poochho — Zuno AI Tutor | Class 10 Science`
- Description: `Bihar Board Class 10 Science ka koi bhi doubt seedha poochho. Zuno AI Tutor Hinglish mein grounded jawab deta hai — Physics, Chemistry, Biology sab cover.`
- Canonical: `https://learnzuno.in/chat`

**Support Page (`/support`)**
- Title: `Help & Support — Zuno AI Tutor`
- Description: `Zuno AI Tutor se koi problem hai? Bug report karo, feedback do, ya koi sawaal poochho. Hum 24 ghante mein reply karte hain.`
- Canonical: `https://learnzuno.in/support`

**Login Page (`/login`)** — noindex
- Title: `Login — Zuno AI Tutor`
- `<meta name="robots" content="noindex, nofollow" />`
- Kyun: Login page Google mein dikhane ki zaroorat nahi. Crawl budget waste hota hai.

**Register Page (`/register`)** — noindex
- Title: `Account Banao — Zuno AI Tutor`
- `<meta name="robots" content="noindex, nofollow" />`

**Other auth pages** (`/verify-email`, `/forgot-password`, `/reset-password`) — noindex
- Sab pe `<meta name="robots" content="noindex, nofollow" />`

### Files:
- `frontend/package.json` — MODIFY (react-helmet-async dependency)
- `frontend/src/main.jsx` — MODIFY (HelmetProvider wrapper)
- `frontend/src/pages/LandingPage.jsx` — MODIFY
- `frontend/src/pages/ChatPage.jsx` — MODIFY
- `frontend/src/pages/SupportPage.jsx` — MODIFY
- `frontend/src/pages/LoginPage.jsx` — MODIFY
- `frontend/src/pages/RegisterPage.jsx` — MODIFY
- `frontend/src/pages/VerifyEmailPage.jsx` — MODIFY
- `frontend/src/pages/ForgotPasswordPage.jsx` — MODIFY
- `frontend/src/pages/ResetPasswordPage.jsx` — MODIFY

---

## Phase 4 — Landing Page H1 Heading Fix

**Time: 15 min | Kaun: AI**

### Problem
Landing page mein "Zuno" brand name ek `<div>` tag mein hai:
```html
<div class="landing-brand-name">Zuno</div>
```

Google `<h1>` tag ko sabse important heading maanta hai. Har page pe ek `<h1>` honi chahiye jo page ka main topic bataye. Abhi koi `<h1>` hai hi nahi — poore app mein kahin bhi nahi.

### Fix
- `landing-brand-name` ko `<h1>` tag banana
- Landing page pe ek proper heading hierarchy banana (`h1` > `h2` etc.)
- CSS adjust karna taaki dikhne mein koi change na aaye

### File:
- `frontend/src/pages/LandingPage.jsx` — MODIFY

---

## Phase 5 — OG Image (Social Sharing Image)

**Time: 30 min | Kaun: AI**

Jab koi tumhara link WhatsApp ya Telegram mein share kare, toh ek achha dikhne wala card aana chahiye — title, description, aur ek image.

### Specifications:
- Size: 1200 × 630 pixels (standard social share size)
- Content: Zuno logo, "Bihar Board Class 10 Science AI Tutor", clean professional design
- Format: PNG
- File size: Under 500 KB

### File:
- `frontend/public/og-image.png` — NEW

---

## Phase 6 — Pre-rendering (Google Ko Real Content Dikhao)

**Time: 3-4 hrs | Kaun: AI**

> ⚠️ **STATUS 2026-08-29 — REVERTED. Never worked in production.**
> The first attempt (commits `2b08f6b`, `d704a74`) added a Playwright prerender
> step to the build: `vite build && npx playwright install chromium && node
> scripts/prerender.js`. It passed locally but **every Vercel deploy since the
> 2026-08-28 `seo-work` merge failed** — `chrome-headless-shell` exits with
> code 127 (missing system shared libraries; Vercel's build sandbox has no
> browser libs and no root/apt to install them). This kept the entire frontend
> undeployable for a day.
>
> Fix (branch `frontend-vercel-build-fix`): build script back to plain
> `vite build`; `playwright` devDependency, `scripts/prerender.js`, and the
> `/support → /support.html` rewrite removed. All browser-free SEO (static
> OG/Twitter/JSON-LD tags in `index.html`, `sitemap.xml`, `robots.txt`,
> `og-image.png`, per-route react-helmet-async tags) still ships and works.
>
> If prerendering is revisited: use **Option A** below (`@sparticuz/chromium`),
> and it MUST be verified on a real Vercel **preview** deploy before merging to
> `main` — never again on local build alone. Tracked in `BACKLOG.md`.

### Problem
Google ka robot tumhare page pe aata hai → use khali `<div id="root"></div>` milta hai → usse lagta hai page khali hai.

Haan, Googlebot 2026 mein JavaScript render kar sakta hai. Lekin:
- Rendering mein delay hota hai (din ya hafte)
- Social media crawlers (WhatsApp, Telegram, Twitter) JavaScript bilkul nahi samajhte
- Pre-rendered page se indexing tez hoti hai

### Approach
Build time pe public pages ka HTML pehle se bana ke rakh dena:
1. `vite build` normal run hoga (JS bundles banayega)
2. Ek Node script Puppeteer (headless browser) se `/` aur `/support` visit karega
3. Jo HTML render hoga, use `dist/` folder mein save kar dega
4. Deploy hone pe Google ko seedha ready HTML milega

### Kaunse pages pre-render honge:
- `/` (Landing Page) — Sabse important
- `/support` (Support Page) — Public page

### Kaunse pages pre-render NAHI honge:
- `/chat` — Dynamic page, har user ka alag content
- Auth pages — Google mein dikhane ki zaroorat nahi

### Vercel build pe Puppeteer ki limitation:
Vercel ke build environment mein full Puppeteer chalna mushkil ho sakta hai. Do approaches hain:
- **Option A:** `puppeteer-core` + `@sparticuz/chromium` (lightweight Chromium for serverless/CI)
- **Option B:** Locally pre-render karo, output ko commit karo, Vercel direct serve kare
- Implementation ke waqt dono try karenge, jo kaam kare woh use karenge.

### Files:
- `frontend/scripts/prerender.js` — NEW
- `frontend/package.json` — MODIFY (puppeteer dependency, build script update)
- `frontend/vercel.json` — MODIFY (pre-rendered pages serve karne ke liye)

---

## Phase 7 — Google Analytics 4 Setup

**Time: 30 min | Kaun: Dono (User Google pe setup karega, AI code mein add karega)**

### Kya hai?
Google Analytics (GA4) ek free tool hai jisse tumhe pata chalta hai:
- Kitne log tumhari site pe aa rahe hain
- Kahan se aa rahe hain (Google search se? Direct? WhatsApp link se?)
- Kaunsa page zyada dekhte hain
- Kitni der rehte hain

### Kyun zaruri?
Bina analytics ke tumhe kuch pata nahi chalega ki SEO kaam kar raha hai ya nahi. Ye tumhara "report card" hai.

### Kaise hoga:
1. User Google Analytics pe account banayega
2. Ek Measurement ID milega (format: `G-XXXXXXXXXX`)
3. AI index.html mein GA4 tracking script add karega

### Files:
- `frontend/index.html` — MODIFY (GA4 script tag)

---

## Phase 8 — Vercel Configuration (Headers + Trailing Slash)

**Time: 15 min | Kaun: AI**

### Trailing slash consistency
- Abhi `learnzuno.in/chat` aur `learnzuno.in/chat/` dono kaam karte hain
- Google dono ko alag page maanta hai — ye "duplicate content" issue create karta hai
- Fix: Vercel config mein `"trailingSlash": false` set karenge — slash wala URL automatically redirect hoga bina slash wale pe

### Security + Caching headers
- `X-Content-Type-Options: nosniff` — security
- `X-Frame-Options: DENY` — clickjacking protection
- Cache headers for static assets — performance improvement (indirect SEO factor)

### File:
- `frontend/vercel.json` — MODIFY

---

## Phase 9 — Google Search Console Registration

**Time: 30 min | Kaun: User (AI step by step guide karega)**

### Kya karna hai:
1. [Google Search Console](https://search.google.com/search-console) pe jaana
2. "Add Property" click karna
3. `learnzuno.in` domain daalna
4. Verification — 2 options:
   - **Option A (Best):** Domain provider ke DNS settings mein ek TXT record add karna
   - **Option B:** HTML meta tag (ye Phase 1 mein pehle se jagah bana di hai)
5. Verify hone ke baad "Sitemaps" section mein `sitemap.xml` submit karna
6. "URL Inspection" tool mein homepage URL daalke "Request Indexing" click karna

### Iske baad:
- Google 3-14 din mein site crawl karega
- Dashboard mein dikhega: kitne pages index hue, kya errors hain, kaunse keywords pe log aa rahe hain

### Pre-requisite:
- Phase 1-8 sab deploy ho chuke hone chahiye pehle
- Taaki jab Google crawl kare, use puri tarah ready site mile

### File:
- `frontend/index.html` — MODIFY (google-site-verification meta tag value update)

---

## Phase 10 — Deploy + Test + Verify

**Time: 1 hr | Kaun: Dono**

### Deploy steps:
1. Sab changes verify karna locally
2. `seo-work` branch ko `main` mein merge karna
3. Vercel auto-deploy karega

### Test tools:

| Tool | Kya Check Karega |
|------|-----------------|
| **View Page Source** (browser) | Pre-rendered HTML mein actual content aa raha hai ya sirf `<div id="root"></div>` |
| **Google Rich Results Test** | Structured data (JSON-LD) sahi parse ho raha hai ya nahi |
| **Facebook Sharing Debugger** | OG tags kaam kar rahe hain — WhatsApp/FB share preview sahi dikhega ya nahi |
| **Twitter Card Validator** | Twitter share preview sahi dikhega ya nahi |
| **Google PageSpeed Insights** | Page speed score (SEO ranking factor hai) |
| **Google Search Console** | URL Inspection tool se check — Google page ko render kar pa raha hai ya nahi |
| **`site:learnzuno.in`** Google search | 2-3 hafte baad — Google ne index kiya ya nahi |

### Verification checklist:
- [ ] `https://learnzuno.in/robots.txt` accessible hai
- [ ] `https://learnzuno.in/sitemap.xml` accessible hai aur sahi pages list hain
- [ ] Homepage ka View Page Source mein actual content dikhta hai (khali root div nahi)
- [ ] Google Rich Results Test mein structured data pass hota hai
- [ ] Facebook Debugger mein OG image + title + description sahi dikhta hai
- [ ] Google Search Console mein site verified hai
- [ ] Google Search Console mein sitemap submitted hai
- [ ] PageSpeed score mobile pe 90+ hai

---

## Expected Results Timeline

| Time | Kya Expect Karo |
|------|----------------|
| **Day 1** | Sab technical fixes deployed. Site SEO-ready hai. |
| **Week 2-3** | Google crawl karta hai. Search Console mein data aana shuru. |
| **Month 1-2** | `"learn zuno"`, `"zuno ai tutor"`, `"learnzuno"` — brand searches pe result aata hai. |
| **Month 3-4** | `"bihar board class 10 science hindi"`, `"class 10 vigyan notes"` jaise keywords pe Google ke first 2-3 pages pe dikhna shuru. |
| **Month 6+** | Agar backlinks bhi banaye toh competitive keywords pe Page 1 possible. |

> **SEO ek marathon hai, sprint nahi.** Koi bhi tool ya banda jo kehe "24 ghante mein Page 1" — wo scam hai. Real, sustainable ranking 3-6 months ka kaam hai.

---

## Post-Launch Ongoing SEO (User Responsibility)

Ye one-time kaam nahi — deploy ke baad continuously karna:

1. **Google Search Console weekly check** — Kaunse keywords pe traffic, kya errors hain
2. **Quora pe answers likho** — Bihar Board Science ke questions ke jawab do, Zuno ka link daalo
3. **YouTube video banao** — Zuno ka demo/tutorial, description mein link
4. **Student communities mein share** — Telegram groups, WhatsApp groups jahan Bihar Board students hain
5. **Social media presence** — Instagram/Twitter pe Bihar Board students ke liye helpful posts
6. **Content freshness** — Site regularly update karo — Google fresh content ko prefer karta hai

---

## Open Questions (User se poochna hai)

1. **Domain provider kaun hai?** (GoDaddy, Namecheap, Hostinger, etc.) — Search Console DNS verification ke liye zaroori.
2. **Google Search Console pe pehle se registered ho?** Ya fresh start?
3. **Zuno ka koi banner/logo high-quality image hai?** OG image ke liye. Nahi toh AI generate karega.
4. **Google Analytics account hai?** Ya naya banana padega?
