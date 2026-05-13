# Web Audit AI — Lead Enrichment Dashboard

An AI-powered website auditing and lead enrichment platform. Upload business leads, run automated technical audits (SEO, performance, accessibility, security), and enrich them with Gemini-powered sales intelligence.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Next.js 16 App Router               │
│                                                      │
│  ┌─────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │ LeadTable│  │ Detail   │  │ API Routes        │   │
│  │ + Stats  │  │ Drawer   │  │                   │   │
│  └─────────┘  └──────────┘  │  /api/upload  ─────│───│── CSV/Excel
│               ┌──────────┐  │  /api/audit   ─────│───│── site-audit CLI
│               │ AI Sales │  │                    │   │    + Playwright
│               │ Insights │  │  /api/enrich  ─────│───│── Gemini API
│               └──────────┘  └───────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────┐        │
│  │          LocalStorage (leads)            │        │
│  └──────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘
```

## Data Flow

1. **Import** → Upload CSV/Excel via `/api/upload` → mapped to Lead objects → stored in localStorage
2. **Audit** → `/api/audit` runs `@benven/site-audit` CLI (crawl + Lighthouse + SEO checks) + Playwright screenshots → outputs structured AuditData
3. **Enrich** → `/api/enrich` sends audit data to Gemini → returns sales insights (risks, hooks, services)
4. **View** → LeadDetailDrawer displays scores, grades, screenshots, and AI-powered intelligence

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| Audit Engine | `@benven/site-audit` (Lighthouse + SEO crawl) |
| Screenshots | Playwright (Chromium) |
| AI Enrichment | Google Gemini (`@google/generative-ai`) |
| Storage | Browser localStorage |
| Data Import | `xlsx` + `csv-parse` |

## Scores & Grading

The audit engine calculates five dimension scores (0-100), each with a letter grade (A-F):

| Dimension | Weight | Sources |
|-----------|--------|---------|
| Performance | 30% | Lighthouse CWV, PSI API, crawl response times |
| SEO | 25% | Titles, meta, H1, OG tags, sitemap, robots, structured data |
| Accessibility | 20% | Lighthouse a11y score, violation counts |
| Security | 15% | HSTS, CSP, X-Frame-Options, X-Content-Type-Options |
| Design | 10% | Heuristic: typography, color, spacing, layout |

## Setup

### Prerequisites

- Node.js 20+
- npm 9+

### Installation

```bash
cd enrichment-dashboard
npm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Gemini API key from [aistudio.google.com](https://aistudio.google.com/) |
| `NEXT_PUBLIC_MODEL_ID` | No | Gemini model (defaults to `gemini-3.1-flash-lite`) |

### Run

```bash
npm run dev
# Opens at http://localhost:3001
```

### Playwright (for screenshots)

Chromium is auto-installed via `postinstall` hook. If missing:

```bash
npx playwright install chromium
```

## Usage

1. **Add leads** — Upload an Excel/CSV file (columns: `title`, `website`, `review_rating`, `review_count`, `category`) or add manually
2. **Run Audit** — Click "Run Audit" to crawl and score a website (30-50 pages, ~60-90s)
3. **Generate Enrichment** — Click "Generate Enrichment" for AI sales intelligence
4. **View Details** — Click any enriched lead to open the drawer with full scores, red flags, screenshots, and AI insights

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/upload` | POST | Upload Excel/CSV → returns parsed leads |
| `/api/import` | POST | Alternative file import endpoint |
| `/api/audit` | POST | `{ url, depth, maxPages }` → runs site-audit + screenshots + PSI |
| `/api/enrich` | POST | `{ lead, audit }` → Gemini enrichment → sales intelligence |

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── audit/route.ts    # Website auditing endpoint
│   │   ├── enrich/route.ts   # AI enrichment endpoint
│   │   ├── import/route.ts   # File import endpoint
│   │   └── upload/route.ts   # Excel/CSV upload endpoint
│   ├── page.tsx              # Main dashboard page
│   ├── layout.tsx            # Root layout
│   └── globals.css           # Global styles
├── components/
│   └── dashboard/
│       ├── LeadTable.tsx     # Lead listing & actions
│       ├── LeadDetailDrawer.tsx  # Detailed audit + enrichment view
│       ├── Stats.tsx         # Dashboard stat cards
│       └── Sidebar.tsx       # Navigation sidebar
├── hooks/
│   └── useLeads.ts           # localStorage lead persistence
├── types/
│   └── index.ts              # TypeScript interfaces
└── lib/                      # Shared utilities (if any)
```

## License

MIT