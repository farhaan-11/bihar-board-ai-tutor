# UI_PLAN.md — Zuno Frontend Redesign (v2)

**Created:** 2026-06-25
**Owner:** Farhan Raza
**Engineering partner:** Claude (acting as Senior Product Manager + Senior Software Engineer + Senior UI Engineer — 20+ years equivalent experience)
**Status:** 🟡 ACTIVE — P8 FocusModal DONE, dark mode removed (light-only until deployment)
**Previous plan:** Superseded. Steps A–E of the old plan are already shipped in code, but the design system they shipped on (Slate & Pearl / Indigo `#4F46E5`) is being re-evaluated as part of this v2 effort. We will NOT throw away working code — we will refactor design tokens and re-skin existing components. Logic stays.

---

## 0. Why this file exists

Mujhe (Farhan) ek UI overhaul karwana hai jo:
- Smooth, unique, fresh lage — students ke liye relatable
- Light + dark mode dono mein perfect ho
- Har device par responsive ho (360px se 1920px+)
- Brand identity ho — apna tagline, apna content, apna feel
- Koi logical / feature / code bug introduce na ho — sirf UI surface
- Production-ready scale ho — future-proof, maintainable, no shortcuts

Yeh file uska **single source of truth** hai. Har discussion, decision, option, trade-off, edge case yahin record hota hai. Bina is file ko padhe koi bhi naya session yeh redesign continue nahi kar sakta.

---

## 1. Working methodology (HOW we use this file)

Yeh sabse important section hai. Mai (Claude) is workflow ko **strictly** follow karunga, har phase ke liye:

### The 7-stage loop (per phase / per discussion topic)

```
1. DISCOVERY     → Mai current state padhta hoon (files, screenshots, references).
                   Problem ko apne words mein restate karta hoon.
                   Tum confirm karte ho ki mera understanding sahi hai.

2. OPTIONS       → Mai 2–4 alag-alag approaches deta hoon.
                   Har option ke saath:
                     • 1-line summary
                     • Pros (3+ numbered)
                     • Cons / trade-offs (3+ numbered)
                     • Effort (S/M/L)
                     • Future impact (scalability, maintainability)
                     • Visual preview (HTML/SVG widget) jab UI decision ho
                       — light AND dark mode dono dikhauunga

3. RECOMMENDATION → Mai ek option recommend karta hoon, with numbered reasons.
                    Yahan tak kuch implement NAHI hua hai.

4. EDGE CASES &   → Mai apne recommendation ke against khud devil's advocate banta hoon:
   RISK CHECK     • Hidden bugs — kahan toot sakta hai?
                    • Edge cases — empty state, very long text, slow network, etc.
                    • Accessibility — keyboard nav, screen reader, contrast
                    • Performance — re-renders, bundle size
                    • Migration risk — purana code break to nahi karega?
                    • Future-proof — 6 mahine baad scale karega?

5. YOUR CALL      → Tum review karte ho. Sawaal poochte ho. Modify maangte ho.
                    Final decision tumhara hai. Memory rule: "discuss + approve before implement."

6. IMPLEMENT      → Approval ke baad mai code likhta hoon.
                    Chhote, focused commits. Build pass hona chahiye.
                    Cross-mode (light/dark) + cross-device (mobile/tablet/desktop) verify.

7. VERIFY & SIGN  → Mai screenshots / preview deta hoon — light + dark + 3 breakpoints.
   OFF             Tum sign off karte ho. Tab agla phase shuru hota hai.
                    Server kill karna mandatory (memory: port 5001 / 5173 lifecycle).
```

**Iska matlab:**
- Ek baar mein ek phase. Ek phase mein ek decision area.
- Kabhi bhi bina approval ke implement nahi.
- Har stage ke baad is file mein notes update honge — "DISCUSSED", "DECIDED", "SHIPPED" markers ke saath.

---

## 2. My role (what I bring to this project)

Tumne 3 roles assign ki hain. Mai unko aise carry karunga:

### 🧑‍💼 Senior Product Manager
- Student ki perspective sochta hoon — Bihar Board Class 10, Hindi-medium background, low-end phone, slow internet
- Brand voice / tone / tagline / content strategy plan karta hoon
- Feature scope ka guard karta hoon — UI mein logic creep nahi hone dunga
- Success metrics define karta hoon ("kaise pata chalega ki UI better hua?")

### 🧑‍💻 Senior Software Engineer
- React 19 + Vite 6 + MUI v9 ke best practices follow karunga
- No dead code, no premature abstractions, no unused deps
- Performance budget — re-renders, bundle, CLS, LCP watch karunga
- Existing logic (Redux, auth, sessions, API) ko touch nahi karunga
- Build green rakhna mandatory hai har commit pe

### 🎨 Senior UI Engineer
- Design tokens-first approach (color, type, spacing, radius, shadow, motion)
- Light + dark mode token-driven — no hardcoded hex
- Accessibility: WCAG AA minimum (contrast 4.5:1, focus rings, ARIA)
- Responsive: 360, 414, 768, 1024, 1280, 1440, 1920 breakpoints test
- Micro-interactions, motion design, empty states, error states — full polish

---

## 3. Ground rules (non-negotiable)

| # | Rule | Reason |
|---|------|--------|
| 1 | No logic changes — only UI surface | Tumne explicit kaha hai. Backend, API, Redux, auth untouched. |
| 2 | No new bugs — every change verified | Tumne explicit kaha hai. |
| 3 | Discussion → Approval → Implement (never skip) | Memory rule. |
| 4 | Light + dark + responsive — all three at once | Half-done themes hi current problem hai. |
| 5 | Design tokens only — no hex in components | Maintainability. |
| 6 | Build must pass after every commit | Catch regressions early. |
| 7 | Kill dev server after every verify | Memory rule (port lifecycle). |
| 8 | Update this file after every phase | Source of truth. |
| 9 | One phase / one PR-sized change at a time | Reviewability. |
| 10 | Show preview widgets for visual decisions | Tumne specifically maanga — "preview dikhao to choose karna easy hoga." |

---

## 4. What's already shipped (don't redo)

Ye bina nayi UI direction tay kiye bhi tay hai. Code mein already hai:
- React Router setup, auth pages (Login/Register/Forgot/Reset/Verify), Google OAuth callback
- Redux auth slice, axios interceptors, silent refresh on app start
- Chat session management (create, switch, rename, delete, list)
- Guest turn limit + lock states
- ChatMessage rendering (student bubble + Zuno free-text)
- AskBar with cancel + cooldown
- FocusModal (3-step subject → section → chapter picker)
- HistoryPanel (FAB + drawer/floating panel)
- Theme toggle hook + localStorage persistence

**v2 ka scope:** Inhi components ko **re-skin + reorganize + responsive-fix + content-fix** karna. Naya logic nahi.

---

## 5. Audit — current problems (from screenshots + code read)

Yeh wo problems hain jo maine screenshots dekh ke aur saara frontend code padh ke identify kiye. Tum confirm karoge / add karoge.

### 🔴 A. Visual / aesthetic
- A1: Color palette (Indigo + Slate) corporate-SaaS feel deta hai — student product nahi
- A2: Light mode dull-gray `#F0F2F5` — flat, lifeless
- A3: FocusModal hardcoded dark theme (`.focus-dialog` mein `!important` gradient + amber accent) — design system se disconnected, **light mode mein bhi dark dikhta hai** (tumne screenshot mein dikhaya)
- A4: Source chips, kicker text, section headings sab dim — visual hierarchy nahi banti
- A5: Zero brand identity — `Z` + "Zuno" bas. Koi tagline, mascot, illustration, brand moment nahi
- A6: Zuno reply ka koi container/bubble nahi — raw text on bg, "bekaar spacing" feel (tumne kaha)
- A7: Generic thinking dots — koi character nahi

### 🔴 B. Responsiveness
- B1: AskBar `InputBase` mein `multiline` prop nahi — long text single line mein squeeze hota hai, horizontal scroll banta hai (tumne explicit kaha)
- B2: HistoryPanel desktop position `bottom: 188px right: 16px` fixed — chhoti screens par chat ke upar overlap karta hai
- B3: Chapter pill `display: none` xs par — focus mode mobile par invisible
- B4: Chat max-width 700px hard cap — bade screens (1440+) par chat thin strip dikhta hai, bohot whitespace
- B5: Focus + New Chat buttons mobile par text rakhte hain — chhoti screens par overflow risk
- B6: No breakpoint testing matrix — sirf xs/sm consider hua hai, md/lg/xl ignored

### 🔴 C. Light / dark mode
- C1: FocusModal forced dark — already mentioned (A3)
- C2: Shadows dark mode mein `none` — depth khatam, cards flat float karte hain
- C3: Theme toggle snap karta hai — no transition animation
- C4: `[data-theme]` switch hoti hai par CSS variables transition nahi karte — jarring switch

### 🔴 D. Typography & spacing
- D1: 6 different font sizes for similar elements (0.7, 0.72, 0.8, 0.82, 0.85, 0.9 rem) — no type scale discipline
- D2: Single font family (Inter) — koi display moment nahi, brand voice flat
- D3: Line-height inconsistency between sections
- D4: Spacing scale defined par enforce nahi — components mein arbitrary px values

### 🔴 E. Interaction polish
- E1: No empty-state illustration / brand moment
- E2: Buttons par no press feedback / micro-interaction
- E3: Message-in animations nahi — naya message snap karta hai
- E4: HistoryPanel FAB scroll karte time chat ke upar overlap karta hai
- E5: Tagline absent (tumne explicitly chaaha — "iska apna khud ka tagline bnana")

### 🔴 F. Content & copy
- F1: Welcome message generic — "Main Zuno hoon..." — no warmth, no hook
- F2: AskBar placeholder text plain — could be inviting
- F3: Empty states ("Koi purani chat nahi hai") functional par bland
- F4: Auth pages (Login/Register) bilkul plain — brand voice missing
- F5: Error states translatable but no personality
- F6: No landing/marketing context — student ko nahi pata Zuno kya unique karta hai

---

## 6. Phase map (high-level)

Yeh saare phases hain. **Order important hai** — har phase pichle pe build hota hai.
Har phase ka detailed plan us phase ke start hone se pehle is file mein add hoga (current "PENDING-DISCUSSION" markers expand honge).

| Phase | Name | Touches | Discussion topics | Status |
|-------|------|---------|-------------------|--------|
| P0 | Master plan file (yeh file) | Docs | Methodology + role + scope | 🟢 IN PROGRESS |
| P1 | **Design direction** (color, type, mood) | None yet | 3 directions with live preview widgets (light + dark) | ✅ DONE — Direction A locked |
| P2 | **Tagline + brand voice** | `Topbar.jsx`, `AskBar.jsx`, `LoginPage.jsx`, `RegisterPage.jsx`, `ChatPage.jsx` | Direction C "Apni boli mein" — tagline, placeholders, auth copy, welcome message removed | ✅ DONE |
| P3 | **Content strategy** | `AskBar.jsx`, `HistoryPanel.jsx`, `GuestLoginPrompt.jsx`, `ChatPage.jsx` | Guest limit banner, session lock banner, empty state, GuestLoginPrompt copy (factual fix), focus system msg, lock system msg | ✅ DONE |
| P4 | Design tokens implementation | `theme.css`, `zunoTheme.js` | How to migrate without breaking shipped UI | ✅ DONE — verified light + dark, build green |
| P5 | Topbar + logo + brand moment | `Topbar.jsx`, `global.css` | Logo refresh, tagline placement | ✅ DONE — Option 2 (Action Forward), both modes verified |
| P6 | AskBar — multiline + polish | `AskBar.jsx`, CSS | Multiline strategy, max-height, mobile keyboard handling | ✅ DONE — multiline textarea, Enter sends, Shift+Enter newline |
| P7 | ChatMessage redesign | `ChatMessage.jsx`, `global.css`, `theme.css` | Direction 2 Interchange — ghost bubble, prose flow, footnote source | ✅ DONE — source dedup, heading suppressed for single-section |
| P7 | ChatMessage redesign | `ChatMessage.jsx`, CSS | Bubble vs free-text, animations, sections styling | ⬜ PENDING-DISCUSSION |
| P8 | FocusModal restyle | `FocusModal.jsx`, `global.css` | Slide-based nav (Subject→Section→Chapter), back button, CSS animations, light mode clean | ✅ DONE |
| P9 | HistoryPanel rethink | `HistoryPanel.jsx`, `SessionBar.jsx` (new), `ChatPage.jsx` | Session Bar (38px strip above AskBar) replaces FAB. Desktop panel anchored top-left. Search added. | ✅ DONE |
| P10 | Auth pages re-skin | `LoginPage.jsx`, `RegisterPage.jsx`, etc. | Card design, content (P3 output), responsive | ✅ DONE |
| P11 | Landing / first-run experience | New component | What does student see before first message? | ✅ DONE |
| P12 | Empty states + error states polish | `HistoryPanel.jsx`, `ChatPage.jsx`, `StatusNotice.jsx`, `global.css` | Illustrations / SVGs, tone | ✅ DONE |
| P13 | Motion + micro-interactions | CSS + Framer Motion? | Discuss: add a motion lib or stay CSS-only | ⬜ PENDING-DISCUSSION |
| P14 | Responsive sweep | All components | 360/414/768/1024/1280/1440/1920 audit | ⬜ PENDING |
| P15 | Accessibility audit | All components | WCAG AA, keyboard nav, screen reader, focus rings | ⬜ PENDING |
| P16 | Performance + bundle audit | Vite config + lazy routes | Lighthouse pass, bundle analysis | ⬜ PENDING |
| P17 | Final QA + sign-off | Everything | Side-by-side before/after, regression check | ⬜ PENDING |

**Estimated total:** 15–20 working sessions. Har session ~1 phase, kabhi bada phase 2 sessions le sakta hai.

---

## 7. Phase details (expanded as we get there)

Currently sirf P1 ka detailed structure de raha hoon — baaki phases tab expand honge jab unki baari aayegi (taaki yeh file bloat na ho).

---

### 🎨 P1 — Design direction

**Status:** ⬜ PENDING-DISCUSSION
**Estimated duration:** 1 session (discussion + decision) + 0 implementation
**Output:** Locked design direction (palette, type, mood, brand feel)

#### 7.1.1 What we'll discuss
- Visual mood / vibe — kya feel chahiye? (warm + cultural / calm + academic / energetic + youthful / minimal + premium)
- Color palette — primary, secondary, accent, semantic, neutrals — light + dark dono ke liye
- Typography — display + body font pairing
- Brand personality (yeh P2 tagline ke liye foundation banega)

#### 7.1.2 How options will be presented
Mai 3 directions banaunga, har ek ke liye:
1. Naam + 1-line vibe statement
2. **Live preview widget** — actual rendered HTML/SVG showing:
   - Topbar with logo + tagline placeholder
   - 1 sample student message + 1 Zuno response
   - 1 button + 1 input + 1 card
   - **Same view in light AND dark mode side-by-side**
3. Palette swatches (hex codes)
4. Typography sample
5. Pros / Cons / Future-fit / Edge-case warnings

Tum side-by-side dekh ke compare karoge. Modify / mix maang sakte ho.

#### 7.1.3 Tentative direction candidates (will be detailed in actual P1 session)
- Direction A: **Warm Scholar** — saffron/marigold + plum + cream — Indian cultural warmth
- Direction B: **Calm Focus** — teal + sand + burnt orange — Notion/Headspace academic calm
- Direction C: **Energetic Youth** — violet + lime + white — Duolingo-style gamified

(Or a 4th option that emerges from discussion.)

#### 7.1.4 Decision rubric — kis basis pe choose karenge
- Target user fit (Bihar Board Hindi-medium Class 10 student)
- Stands out from generic AI chat apps (ChatGPT/Claude/Gemini sab indigo-slate hain)
- Light + dark mode dono mein equally strong
- Accessibility — contrast ratios AA pass
- Long-term maintainability — token system clean ho

#### 7.1.5 Edge cases / risks to discuss
- "Saffron" cultural appropriation concern? — gender-neutral, religion-neutral framing
- Color blindness — primary/error distinction
- Print / screenshot use case — colors paper pe kaise dikhte hain
- Brand longevity — 2 saal baad bhi fresh lagega?

---

### 📝 P2 — Tagline + brand voice (discussion-heavy phase)

**Status:** ⬜ PENDING-DISCUSSION
**Why separate phase:** Tumne specifically kaha — "is pe detailed discussion krte fir tagline fix krte"

#### 7.2.1 What we'll produce
- 1 primary tagline (the one on logo / hero)
- 2–3 supporting micro-taglines (button CTAs, section headers)
- Tone guide: voice attributes (e.g., warm / direct / encouraging / not preachy)
- Language mix policy: Roman Hinglish primary, English allowed for technical, no Devanagari (already a rule)
- Sample copy across 5 contexts to validate the voice

#### 7.2.2 How options will be presented
- 8–12 tagline candidates in 3 buckets:
  - Bucket A: Pure Hinglish (e.g., "Padhai ka naya dost")
  - Bucket B: Pure English (e.g., "Your Class 10 study buddy")
  - Bucket C: Mixed (e.g., "Smart padhai, simple jawab")
- Each with: meaning, emotional hook, length, where it fits, risks (cringe / cliché / over-promise)

#### 7.2.3 Decision rubric
- Memorable (recall test)
- True to product (no over-promise)
- Translatable across surfaces (logo, landing, app store, social)
- Doesn't feel like a Hindi-English ad agency template

---

### 📰 P3 — Content strategy (per-page copy)

**Status:** ⬜ PENDING-DISCUSSION

#### 7.3.1 Pages / surfaces needing content
| Surface | Current copy | New copy needed? |
|---------|--------------|------------------|
| Welcome message | "Main Zuno hoon..." | Yes — warmer, hook-y |
| AskBar placeholder (global) | "Aaj kya padhna hai?..." | Maybe — keep or polish |
| AskBar placeholder (focus) | "Is chapter ka topic..." | Maybe |
| AskBar hint | "Zuno sirf Bihar Board..." | Probably keep |
| Empty history state | "Koi purani chat nahi hai" | Yes — friendlier |
| Session lock notice | "Is session ki limit reach..." | Yes — softer |
| Guest limit notice | "Guest limit ho gayi" | Yes — encouraging |
| Login page hero | (basic) | Yes — value props |
| Register page hero | (basic) | Yes — value props |
| Landing page (P11) | doesn't exist | Yes — full copy |
| Focus modal title/subtitle | "Select Your Study Path" | Maybe — Hinglish-fy |
| Error states | technical | Yes — student-friendly |
| Thinking state | (none) | Optional — tiny encouragement copy |

#### 7.3.2 How options will be presented
Har surface ke liye 2–3 copy variants with rationale.

#### 7.3.3 Edge cases
- Mixing Hindi + English without sounding fake
- Avoiding kiddie tone (Class 10 students are 15-16, not 8)
- Tone in error states — don't shame the student
- Brevity — chat UI mein lambi copy poison hai

---

### Phases P4–P17 — details added when their turn comes

Bilkul same template (Discovery → Options → Recommendation → Edge cases → Approval → Implement → Verify). Abhi expand nahi karta — jab waha pahunchenge tab.

---

## 8. Decision log

Jo bhi tum approve karoge wo yahan record hoga.

| Date | Phase | Decision | Trade-off accepted |
|------|-------|----------|-------------------|
| 2026-06-25 | P0 | This v2 plan adopted; old plan (Slate & Pearl) deprecated in spirit but its code stays for now | Existing shipped UI continues working during migration |
| 2026-06-25 | P1 | **Direction A — Midnight Scholar** locked. Light: warm cream `#FAFAF8` + burnt orange `#C6570F`. Dark: pure neutral black `#0A0A0A` + gold `#F0A500` (primary accent) + orange `#C6570F` (user bubble). Text scale: `#F4F4F4` / `#C8C8C8` / `#8C8C8C` / `#686868`. Font: Baloo 2 (brand) + Inter (body). | Dark mode primary (gold) differs from user bubble (orange) — handled via `--user-bubble-bg` token |
| 2026-06-25 | P4 | Token implementation started — theme.css + zunoTheme.js + global.css + index.html | No component logic changes, only CSS variable values |
| 2026-06-25 | P7 | **ChatMessage redesign** — Direction 2 "Interchange". Ghost student bubble (rgba tint + border), prose Zuno response (no section headings for single-section), source footnote (chapter-only dedup, strips "Source N:" prefix). | Source footnote visible only when sources present; single-section heading suppressed frontend-side |
| 2026-06-25 | P2 | **Brand voice** — Direction C "Apni boli mein". Topbar micro-tagline added, AskBar placeholders updated, Login/Register copy updated, welcome message removed. Zuno is for all of Class 10 (not just Science). | Welcome message removed permanently — first message from Zuno only appears after student asks |
| 2026-06-26 | P8 | **FocusModal slide nav** — 3-step slide navigation (Subject → Section → Chapter), back button top-left, CSS keyframe animations (`focusSlideFromRight/Left`), available/unavailable/selected card states, 6-subject grid (Science available, rest "Jald aata hai"). | Dark mode deferred — too many MUI CSS variable conflicts between `[data-color-scheme]` and `[data-theme]` attributes. Will implement properly post-deployment. |
| 2026-06-26 | HOTFIX | **Dark mode removed** — `useTheme.js` locked to light-only, `[data-theme="dark"]` CSS removed from `theme.css` + `global.css`, dark `colorScheme` removed from `zunoTheme.js`, theme toggle button removed from `Topbar.jsx`. | Root cause: MUI v9 `cssVariables: true` uses `[data-mui-color-scheme]` but our hook sets `[data-color-scheme]` — Paper background and CSS vars fought each other. Deferred to post-deployment. |
| 2026-06-26 | P9 | **HistoryPanel — Session Bar** — FAB removed. New `SessionBar.jsx` (38px strip above AskBar): "Chats · N" button left, current session name center, "+ New" right. `HistoryPanel` now controlled (`isOpen`/`onClose`/`triggerRef` props). Desktop panel: `position: fixed; top: calc(--topbar-height + 8px); left: 16px` (no overlap with AskBar). Search input added in panel. Mobile: bottom sheet unchanged. | No layout restructure needed — Session Bar sits inside existing flex column. |
| 2026-06-26 | P12 | **Empty & Error states polish** — Added friendly Hinglish error mapping in `StatusNotice.jsx`. Added `MenuBookRounded` and `SearchOffRounded` vibrant SVGs in `HistoryPanel.jsx` empty states. Added a custom gradient SVG and warmer copy in `ChatPage.jsx` first-run empty state. | Kept existing chips but updated text for empathy. Inline SVGs used instead of external assets for performance. |
| 2026-06-26 | P13 | **Motion & Micro-interactions** — Decided against Framer Motion (saves ~50KB). Used Pure CSS for everything: `@keyframes message-pop-in` for chat messages, mobile-safe hovers (`@media (hover: hover)`), tactile active scales (`transform: scale(0.97)`), and global focus-visible states for A11y. Suppressed entrance animations for old history messages to prevent layout/GPU thrashing on load. Changed Thinking State to a static neutral text ("Zuno soch raha hai...") to prevent faux-loading UX issues. | Pure CSS animations are lighter but harder to orchestrate sequentially. Handled history lag by toggling `isNew` flag instead of orchestrating stagger. |
| 2026-06-26 | P14 | **Responsive Sweep** — `theme.css`: Increased `--chat-max-width` to 840px for better 1440p reading. `Topbar.jsx`: On mobile (`xs`), hid the "apni boli mein" tagline, converted Focus button to icon-only, and re-enabled the Chapter pill with smart max-width truncation. `global.css`: Increased student bubble max-width to 90% on mobile. | Hiding text elements on mobile prevents wrapping but removes brand tagline on small devices. |
| 2026-06-26 | P15 | **Accessibility (A11y) Audit** — Added `aria-label` to all icon-only buttons (`AskBar`, `HistoryPanel`, `Topbar`). Upgraded custom `<Box onClick>` elements (SessionRow, User Avatar) to behave like buttons with `role="button"`, `tabIndex={0}`, and `onKeyDown` (Enter/Space support). Updated chat container to use semantic `<main>` tag. | Custom elements require explicit keyboard handling which adds slight boilerplate, but ensures WCAG AA compliance. |
| 2026-06-26 | P16 | **Performance + Bundle Audit** — Implemented Route-level Code Splitting in `App.jsx` using `React.lazy` and `Suspense`. Split the heavy 685KB monolithic bundle into a 448KB core chunk, a 106KB Chat chunk, and tiny 6KB Auth chunks. Eliminated Vite's >500KB bundle warning. | Lazy loading adds a slight flicker on first route navigation, handled via a lightweight fallback loader screen. Crucial for 3G mobile users. |

---

## 9. Open questions (parking lot)

Cheezein jo aayegi baad mein, abhi note kar raha hoon:

- Q1: Motion library use karein (Framer Motion adds ~50KB) ya pure CSS rakhein?
- Q2: Should we add a logo SVG file or keep `Z` text mark?
- Q3: PWA / offline support is scope mein hai ya nahi?
- Q4: Internationalization-ready strings (i18n) ka bare-minimum scaffolding daalein ya skip?
- Q5: Should AI response have a copy/share button? (Not just UI — needs decision)
- Q6: Should we add a "Continue last lesson" entry point on first-load?

---

## 10. Glossary

- **Design token:** A CSS variable / theme variable representing one design decision (color, spacing, font-size). Components consume tokens, never hex.
- **Token migration:** Replacing the current token *values* without changing token *names*, so components don't need rewrites.
- **Surface:** Any visible UI area — chat, modal, drawer, button, toast.
- **Phase:** A self-contained chunk of work with its own discussion-approval-implement-verify cycle.
- **Re-skin:** Visual change without logic change.

---

## 11. Current status & next actions

### ✅ Shipped this session (2026-06-26)
- P7: ChatMessage — ghost bubble, prose layout, footnote source dedup
- P2: Brand voice — topbar tagline, placeholders, auth copy, welcome message removed
- P8: FocusModal — 3-step slide navigation, back button, CSS animations
- HOTFIX: Dark mode removed — light-only until post-deployment
- P9: HistoryPanel — FAB removed, Session Bar added (38px strip: "Chats · count" + session name + "+ New"), desktop panel anchored top-left below topbar, search input added, mobile bottom sheet unchanged
- P12: Empty & Error states — Added vibrant SVG icon & friendly Hinglish copy for zero-history, search-empty, and error states.

### 🎯 Next session — remaining phases
| Priority | Task |
|----------|------|
| ~~1~~ | ~~**P3 — Content strategy**~~ ✅ DONE |
| ~~2~~ | ~~**P10 — Auth pages re-skin**~~ ✅ DONE |
| ~~3~~ | ~~**P11 — Landing / first-run experience**~~ ✅ DONE |
| 4 | **P13–P17 — Micro-interactions, responsive sweep, a11y, final QA** |
| 5 | **Dark mode re-implementation** — post-deployment, fix MUI `colorSchemeSelector` using `useColorScheme` hook |

### 🔖 Dark mode root cause note (for next session)
MUI v9 `cssVariables: true` generates `--mui-palette-*` vars scoped to `[data-mui-color-scheme]`. Our custom `useTheme.js` sets `[data-theme]` and `[data-color-scheme]` but NOT `[data-mui-color-scheme]`. Fix: either (a) set `colorSchemeSelector: '[data-color-scheme]'` in `zunoTheme.js` AND replace `useTheme.js` with MUI's `useColorScheme` hook, or (b) move all MUI Paper/Dialog colors to `var(--*)` tokens with `!important` via `styleOverrides`.
