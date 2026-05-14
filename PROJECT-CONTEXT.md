# Web Audit AI — Full Project Context

> **Purpose:** This document gives any future LLM/coding tool 100% context about this project so it doesn't waste tokens re-discovering architecture, breaking fixes, or making the same mistakes. Read this first before touching any code.

---

## 1. What This Product Is

**Web Audit AI** is a lead enrichment dashboard for web development agencies. It takes a list of local businesses (via Excel upload), runs automated technical audits on their websites (SEO, performance, accessibility, security, design, broken links, mobile responsiveness, images), enriches each lead with Gemini-powered AI sales intelligence (risk factors, value gaps, sales hooks, competitive positioning), and produces downloadable HTML reports.

**Repository:** `https://github.com/AbhayXplor/web-audit-ai`

---

## 2. Tech Stack (Complete)

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.6 |
| Language | TypeScript | 5.x |
| Runtime | Node.js | 22.x |
| Styling | Tailwind CSS | v4 |
| Icons | Lucide React | 1.x |
| Audit CLI | `@benven/site-audit` | 1.1.0 |
| Browser Automation | Playwright (Chromium) | 1.60.0 |
| AI Enrichment | `@google/generative-ai` | 0.24.1 |
| Model | `gemini-3.1-flash-lite` | (configurable via env) |
| Data Import | `xlsx` | 0.18.5 |
| ID Generation | `uuid` | 11.x |
| Storage | Browser localStorage | — |
| Dev Server Port | `3001` | — |

---

## 3. Full File Structure

```
enrichment-dashboard/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── audit/route.ts        # Main website audit (POST + GET for progress)
│   │   │   ├── enrich/route.ts       # Gemini AI enrichment
│   │   │   ├── batch-audit/route.ts  # Queue-based batch audit
│   │   │   ├── report/route.ts       # HTML report generation
│   │   │   ├── import/route.ts       # Alternative file import
│   │   │   └── upload/route.ts       # Excel/CSV upload
│   │   ├── page.tsx                  # Main dashboard
│   │   ├── layout.tsx                # Root layout (Inter + Outfit fonts)
│   │   └── globals.css               # Tailwind + custom styles
│   ├── components/
│   │   └── dashboard/
│   │       ├── LeadTable.tsx         # Lead table + audit/enrich actions
│   │       ├── LeadDetailDrawer.tsx  # Full audit detail + AI insights drawer
│   │       ├── Stats.tsx             # Dashboard stat cards
│   │       └── Sidebar.tsx           # Navigation sidebar
│   ├── hooks/
│   │   └── useLeads.ts               # localStorage CRUD for leads
│   ├── types/
│   │   └── index.ts                  # All TypeScript interfaces
│   └── lib/                          # (empty — for shared utilities)
├── .env.example                      # Template for required env vars
├── .env.local                        # ACTUAL secrets (gitignored)
├── .gitignore                        # Excludes .env, node_modules, .next, etc.
├── next.config.ts                    # Next.js 16 config
├── package.json                      # Dependencies
├── tsconfig.json                     # TypeScript config
├── postcss.config.mjs                # PostCSS/Tailwind config
├── eslint.config.mjs                 # ESLint config
├── README.md                         # Public-facing README
└── PROJECT-CONTEXT.md                # THIS FILE — full context for LLMs
```

---

## 4. Data Flow (Sequential)

```
Excel Upload (title, website, review_rating, review_count, category)
    │
    ▼
/api/upload → maps columns → Lead objects → localStorage
    │
    ▼
User clicks "Run Audit"
    │
    ▼
/api/audit POST { url, depth:3, maxPages:30 }
    │
    ├─► site-audit CLI (crawl + Lighthouse CWV + SEO issues)
    │       Tries: 1) Direct binary → 2) npx fallback → 3) JSON recovery from error stdout
    │
    ├─► Playwright (Chromium)
    │       Desktop 1280×800: extracts title, meta, H1, links, design metrics, images
    │       Mobile 375×667: overflow, tap targets, font sizes, spacing
    │       Screenshots (JPEG quality 50)
    │
    ├─► Independent broken link HEAD checks (up to 50 links, 5s timeout each)
    │
    ├─► PageSpeed Insights API v5 (8s timeout)
    │
    └─► buildAudit() → computes 5 scores + red flags
    │
    ▼
Lead status: 'audited' with AuditData in localStorage
    │
    ▼
User clicks "Generate Enrichment"
    │
    ▼
/api/enrich POST { lead, audit (NO screenshots — removed to save payload) }
    │
    └─► Gemini API → returns JSON: summary, riskFactors, valueGaps, salesHooks,
            competitivePosition, recommendedServices, priority
    │
    ▼
Lead status: 'enriched'
    │
    ▼
User clicks lead name → LeadDetailDrawer shows everything
```

---

## 5. Scoring System

### Overall Score Formula
```
overall = performance*0.30 + seo*0.25 + accessibility*0.20 + security*0.15 + design*0.10
```

### Letter Grades
```
A: ≥90, B: ≥80, C: ≥70, D: ≥60, F: <60
```

### Performance Score Sources (priority order)
1. site-audit Lighthouse `performanceScore` (if present)
2. PageSpeed Insights API `categories.performance.score`
3. LCP-based heuristic (LCP < 1200→95, < 2500→80, < 4000→50, else 30)
4. Default fallback: 50

### SEO Score Sources
1. PageSpeed Insights `categories.seo.score`
2. Calculated from issues: `100 - errors*5 - warnings*2 - info*0.5`

### Accessibility Score Sources
1. PageSpeed Insights `categories.accessibility.score`
2. Calculated from violations: `100 - critical*8 - serious*3`

### Security Score
- All 3 headers (HSTS + CSP + XFO): 90
- Any 1 header: 70
- None: 50

### Design Score (NOW REAL — was hardcoded 65)
Computed from Playwright `page.evaluate()` measuring:
| Sub-score | Measured From |
|-----------|--------------|
| typography | font-size (≥16px), line-height ratio (1.5-1.8), heading consistency |
| color | WCAG contrast ratio (≥7→AAA, ≥4.5→AA), CSS framework (Tailwind +5) |
| spacing | margin consistency (% within 30% of average), avg margin 16-32px |
| layout | mobile overflow check, CSS framework detection |
| interaction | transitions/animations, mobile tap targets (≥48px), tap spacing |
| consistency | heading fonts ≤2 families, framework detection |
| polish | image alt text %, next-gen formats, oversized images, viewport meta |
Final = average of all 7 sub-scores

---

## 6. Playwright Deep Analysis (What's Extracted)

**Desktop (1280×800):**
- `page.evaluate()` extracts:
  - title, metaDescription, h1Count, canonical, OG tags, lang, viewport
  - Body font-size, line-height, color, background-color, font-family
  - CSS framework detection (Tailwind if class*="flex/grid/p-/m-", Bootstrap if class*="col-/row/container")
  - Heading consistency (all h1-h6 fonts ≤2 families → consistent)
  - WCAG contrast ratio (body text vs background, using relative luminance formula)
  - Margin consistency across p/div/section/article elements
  - Interactive elements: transition/animation presence, count
  - Image analysis: alt, dimensions (width+height), natural vs display size, lazy loading, WebP/AVIF detection
  - All visible links (up to 100) for broken link checking

**Mobile (375×667):**
- `page.evaluate()` extracts:
  - Viewport meta content
  - Horizontal overflow (docWidth > viewportWidth + 5)
  - Tap target sizes (< 48px → flagged)
  - Body font size, small fonts (< 12px count)
  - Tap target proximity (elements closer than 32px vertical or overlapping horizontally)

---

## 7. Red Flags Generated

Red flags are triggered at specific thresholds:

| Condition | Severity | Category |
|-----------|----------|----------|
| LCP > 4000ms | critical | performance |
| 20+ broken links (HEAD-checked) | critical | links |
| 5+ broken links (HEAD-checked) | high | links |
| Missing HSTS | critical | security |
| robots.txt blocks all | critical | seo |
| LCP > 2500ms | high | performance |
| INP > 200ms | high | performance |
| No Open Graph tags | high | seo |
| No structured data | high | seo |
| Duplicate titles | high | seo |
| A11y score < 70 | high | accessibility |
| 5+ mobile tap targets <48px | high | accessibility |
| Horizontal overflow on mobile | high | design |
| 5+ tap targets too close | medium | design |
| 3+ images missing alt | high | seo |
| 3+ images oversized | medium | performance |
| Performance score < 70 | medium | performance |
| SEO score < 70 | medium | seo |
| No sitemap.xml | medium | seo |
| Missing H1 on homepage | medium | seo |

---

## 8. Batch Audit System

**API:** `POST /api/batch-audit` with `{ leads: [...] }` → returns `{ batchId, total }`
**Progress:** `GET /api/batch-audit?id=xxx` → returns `{ status, current, total, progress%, leads[] }`

**Frontend flow:** User clicks "Audit All (N)" → posts all 'new' leads to `/api/batch-audit` → polls every 2s → shows "Auditing 45%..." → updates each lead to 'audited' as it completes → shows final alert with succeeded/failed counts → stops polling after 10 min timeout.

**Server flow:** Processes leads sequentially (not parallel to avoid overloading). Each lead gets depth=2, maxPages=10 (faster than single audits). Runs async — doesn't block response.

---

## 9. PDF/HTML Report Generation

**API:** `POST /api/report` with `{ lead, audit, enrichment }` → returns HTML blob

The report includes:
- Cover page with business name, URL, score circle (colored by grade)
- Score grid (5 dimensions with grades)
- Core Web Vitals table (mobile + desktop, PASS/FAIL badges)
- Red flags list with severity colors
- SEO checklist (title, meta, H1, canonical, OG, structured data, sitemap, robots)
- Links table (total, broken, redirect chains, orphan pages)
- Mobile responsiveness section (viewport, overflow, tap targets, fonts)
- Design analysis (7 sub-scores)
- AI enrichment section (if available): summary, risk factors, value gaps, sales hooks, services
- Footer with timestamp, pages crawled, crawl duration

Download triggered client-side via `URL.createObjectURL(blob)`.

---

## 10. API Routes Summary

| Route | Method | Input | Output | Notes |
|-------|--------|-------|--------|-------|
| `/api/audit` | POST | `{url, depth?, maxPages?}` | `{audit: AuditData}` | Also GET for progress polling |
| `/api/enrich` | POST | `{lead, audit}` | `{enrichment}` | Screenshots stripped before sending |
| `/api/batch-audit` | POST | `{leads: [...]}` | `{batchId, total}` | Async processing |
| `/api/batch-audit?id=X` | GET | query param | `{status, progress, leads}` | Poll for progress |
| `/api/report` | POST | `{lead, audit, enrichment?}` | HTML blob | Downloadable report |
| `/api/upload` | POST | FormData (file) | `{leads: Lead[]}` | Excel/CSV → mapped leads |
| `/api/import` | POST | FormData (file) | `{leads: Lead[]}` | Alternative import |

---

## 11. Known Bugs We Fixed (DO NOT REINTRODUCE)

### ❌ BUG #1: `npx @benven/site-audit` fails silently in Next.js API routes
**Symptom:** Audit runs, falls back to Playwright-only mode, produces generic ~50-55 scores with "⚠ Fallback mode" red flag.
**Root Cause:** `exec('npx ...')` can't find the locally installed package when Next.js server's CWD/resolution differs from the project root.
**Fix Applied:** Dual-path resolution:
1. Try direct binary path: `resolve(cwd, 'node_modules/@benven/site-audit/dist/cli.js')` via `execFileAsync(process.execPath, [binPath, ...args])`
2. Fallback to `npx --yes @benven/site-audit` via `execAsync()`
3. If both fail, try to recover JSON from `e2.stdout` in error object (non-zero exit but valid JSON)
4. Use `--ci` flag to suppress npx spinners (they break stdout parsing)
**DO NOT:** Change back to only using `npx` via `exec()`.

### ❌ BUG #2: Non-existent Gemini model name
**Symptom:** `[403 Forbidden] Your project has been denied access` when calling Gemini.
**Root Cause:** Model name `gemini-3.1-flash-lite` was valid by name recognition but the API key's project didn't have access.
**Fix:** Model is configured in `.env.local` as `NEXT_PUBLIC_MODEL_ID=gemini-3.1-flash-lite`. If it returns 403, the API KEY needs model access granted at https://aistudio.google.com — NOT the model name changed.
**DO NOT:** Randomly change the model name to `gemini-2.0-flash` or others without the user's explicit instruction. The user specifically chose `3.1-flash-lite`.

### ❌ BUG #3: `id` variable scoped inside try block but used in catch
**Symptom:** TypeScript error `Cannot find name 'id'` on line 369 of audit/route.ts.
**Root Cause:** `const id = externalId || requestId` was declared inside the `try` block but referenced in the `catch` block's error log.
**Fix:** Changed to `console.error('[AUDIT:${requestId}] Fatal error:', error)` — uses `requestId` which is in outer scope.
**DO NOT:** Move `id` declaration outside the try block — just use `requestId` in the catch.

### ❌ BUG #4: `export const config = { api: { bodyParser } }` deprecated in App Router
**Symptom:** Build warning about unrecognized `config` export in route.
**Root Cause:** This is Pages Router syntax. App Router handles body parsing natively via web `Request` API.
**Fix:** Removed the entire `export const config` block from enrich/route.ts.
**DO NOT:** Add back `bodyParser` config to any API route in this App Router project.

### ❌ BUG #5: Screenshots sent in enrichment payload exceeding body limits
**Symptom:** Enrichment calls fail silently or timeout.
**Root Cause:** Base64 screenshots (~200KB each) were included in the enrichment request body.
**Fix:** LeadTable.tsx deletes `screenshotDesktop` and `screenshotMobile` from `prunedAudit` before sending to `/api/enrich`. Screenshots remain in the audit response for the UI drawer. Gemini only needs text data for its analysis.
**DO NOT:** Re-add screenshots to the enrichment payload.

### ❌ BUG #6: Fallback audit producing identical ~50-60 scores without user awareness
**Symptom:** Every audit shows scores around 50-65 with no real variation.
**Root Cause:** When site-audit CLI failed entirely, the fallback returned generic mid-range scores.
**Fix:** Red flag now says `"⚠ Fallback mode: deep audit unavailable"` so users know scores are estimated. Real design scores from Playwright still apply even in fallback mode.
**DO NOT:** Remove the fallback red flag — it tells the user data is estimated.

### ❌ BUG #7: Enrichment errors silently swallowed → user sees "Audited" status
**Symptom:** User clicks "Generate Enrichment", sees "Processing..." briefly, then it goes back to "Audited" with no error.
**Root Cause:** `catch` block in LeadTable's `handleAction` reverted to `'audited'` status with only `console.error` — no user-facing error.
**Fix:** Added `alert()` with actual error message. User now sees e.g. `"Enrichment failed: model '...' not found"`.
**DO NOT:** Remove the alert — it's the only user-facing error indicator. Could be upgraded to a toast later, but don't silently swallow.

### ❌ BUG #8: Port 3001 already in use when starting dev server
**Symptom:** `Error: listen EADDRINUSE: address already in use :::3001`
**Root Cause:** Previous dev server process still running.
**Fix:** `taskkill /F /PID <pid>` where PID is found via `netstat -ano | findstr :3001`.
**DO NOT:** Change the port number — it's intentionally on 3001.

---

## 12. Critical Implementation Details (Do Not Change)

### Site-Audit CLI Binary Resolution
The audit engine uses `@benven/site-audit` as a CLI tool. It's NOT an importable library — it must be spawned as a child process. The binary lives at `node_modules/@benven/site-audit/dist/cli.js`. On Windows, the `.cmd` wrapper is at `node_modules/.bin/site-audit.cmd`.

### Screenshot Quality
JPEG quality is set to 50 (was 80 before fixes). Lower quality reduces payload size ~60% while remaining readable for visual inspection. Do not increase without a reason.

### Link Checking
Links are collected from `page.evaluate()` on the desktop viewport, deduplicated, resolved, and tested with HEAD requests (5s timeout, manual redirect). Stops checking after 20 errors found. Up to 50 links checked per audit.

### Gemini Prompt
The Gemini prompt is built dynamically using template literals with actual audit data. It asks for JSON output only. The response JSON is extracted by finding `{` and `}` boundaries. If Gemini returns non-JSON, the route returns 500 with the raw text for debugging.

### Lead Persistence
Leads are stored in `localStorage` under key `'enrichment_leads'`. The `useLeads` hook handles JSON serialization. No database — all client-side. This means:
- Leads persist across browser sessions on the same machine
- There's a ~5MB localStorage limit
- No multi-user support
- Clear leads via "Clear All" button or `localStorage.clear()` in console

### Batch Audit Process
`processBatch()` runs sequentially (for loop, not Promise.all) to avoid overwhelming the audit engine. It calls the `/api/audit` endpoint internally (self-referencing). The `NEXT_PUBLIC_BASE_URL` env var or `'http://localhost:3001'` is used as the base URL for the internal fetch.

---

## 13. Environment Variables

| Variable | Required | Default | File |
|----------|----------|---------|------|
| `GOOGLE_API_KEY` | Yes | — | `.env.local` (gitignored) |
| `NEXT_PUBLIC_MODEL_ID` | No | `gemini-3.1-flash-lite` | `.env.local` (gitignored) |

`.env.example` is committed to the repo as a template.

---

## 14. npm Scripts

```bash
npm run dev       # Start dev server on port 3001
npm run build     # Production build (checks TypeScript)
npm run lint      # ESLint
npm postinstall   # Auto-installs Playwright Chromium
```

---

## 15. Git Branch & Remote

- **Remote:** `https://github.com/AbhayXplor/web-audit-ai.git`
- **Branch:** `main`
- **Latest commit (audit improvements):** `71773ee`
- **Previous commit (initial):** `0b84df1`
- **Gitignored:** `.env`, `.env.local`, `.env.*.local`, `node_modules/`, `.next/`, `*.tsbuildinfo`
- **`.env.example` IS committed** (template only, no real keys)

---

## 16. TypeScript Interfaces (Key Types)

```typescript
type LeadStatus = 'new' | 'auditing' | 'audited' | 'enriching' | 'enriched' | 'failed';

interface Lead {
  id: string;
  name: string;
  website: string;
  phone?: string;
  address?: string;
  rating?: number;
  reviews?: number;
  category?: string;
  status: LeadStatus;
  audit?: AuditData;
  enrichment?: { summary, riskFactors[], valueGaps[], salesHooks[], priority, competitivePosition?, recommendedServices?, timestamp };
}

interface AuditData {
  performanceScore, seoScore, accessibilityScore, securityScore, designScore, overallScore: number;
  overallGrade, performanceGrade, seoGrade, accessibilityGrade, securityGrade: 'A'|'B'|'C'|'D'|'F';
  recommendations: { downloadReport, priority, suggestedServices[], estimatedEffort, expectedImpact };
  webVitals: { desktop: CoreWebVitals, mobile: CoreWebVitals };
  seo: SEOChecks;
  accessibility: AccessibilityChecks;
  security: SecurityHeaders;
  links: LinkAnalysis;
  design: DesignScore;
  screenshotDesktop?, screenshotMobile?: string;  // base64
  pagesCrawled, crawlDuration, timestamp: number;
  redFlags: Array<{ severity, category, message, impact, affectedUrls? }>;
  imageIssues?: any[];
  mobileChecks?: any;
}
```

Full types are in `src/types/index.ts`. **Do not modify field names** without updating both the API route and all components that reference them.

---

## 17. Rules for Future Development

1. **Never** change the site-audit execution to use only `npx` via `exec()` — the dual-path fallback is there for a reason on Windows.
2. **Never** remove the `--ci` flag from the site-audit command — without it, npx spinners break JSON parsing.
3. **Never** send screenshots in the enrichment body — they're stripped in LeadTable before the fetch.
4. **Never** change the model name in `.env.local` without user's explicit request — the user specifically chose `gemini-3.1-flash-lite`.
5. **Never** use Pages Router config syntax (`export const config = { api: {} }`) — this is App Router.
6. **Never** move variable declarations between try/catch scopes without checking both blocks.
7. **Never** silently swallow errors in user-facing actions — always show an alert or toast.
8. **Always** run `npm run build` after any TypeScript changes to verify no errors.
9. **Always** use `cmd /c` prefix for Windows shell commands (the user's machine is Windows 11 with PowerShell).
10. The dev server runs on port **3001** (not 3000). Kill old processes if `EADDRINUSE` occurs.