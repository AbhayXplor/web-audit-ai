import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Part } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

// Use configured model or default
const MODEL_ID = process.env.NEXT_PUBLIC_MODEL_ID || 'gemini-3.1-flash-lite';
console.log(`[ENRICH] Using model: ${MODEL_ID}`);

// Retry config for 503/overload errors
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function extractContext(lead: any, audit: any) {
  const redFlagsContext = audit.redFlags?.length
    ? audit.redFlags.map((f: any) => `[${f.severity.toUpperCase()}] ${f.message} (${f.category})`).join('\n')
    : 'None detected.';

  const c = audit.conversion?.raw || {};
  const design = audit.design || {};

  return {
    name: lead.name,
    website: lead.website,
    industry: lead.category || 'Unknown',
    rating: lead.rating ?? 0,
    reviews: lead.reviews ?? 0,
    address: lead.address || 'Not specified',
    overall: audit.overallScore ?? 0,
    perf: audit.performanceScore ?? 0,
    seo: audit.seoScore ?? 0,
    a11y: audit.accessibilityScore ?? 0,
    security: audit.securityScore ?? 0,
    designScore: audit.designScore ?? 0,
    lcp: audit.webVitals?.mobile?.lcp ? (audit.webVitals.mobile.lcp / 1000).toFixed(1) : 'N/A',
    cls: audit.webVitals?.mobile?.cls?.toFixed(3) || 'N/A',
    inp: audit.webVitals?.mobile?.inp
      ? `${audit.webVitals.mobile.inp}ms`
      : 'N/A',
    fcp: audit.webVitals?.mobile?.fcp
      ? `${(audit.webVitals.mobile.fcp / 1000).toFixed(1)}s`
      : 'N/A',
    ttfb: audit.webVitals?.mobile?.ttfb
      ? `${audit.webVitals.mobile.ttfb}ms`
      : 'N/A',
    title: audit.seo?.title?.present
      ? `"${audit.seo.title.value}" (${audit.seo.title.length} chars)`
      : 'MISSING',
    meta: audit.seo?.metaDescription?.present
      ? `"${audit.seo.metaDescription.value}"`
      : 'MISSING',
    h1Count: audit.seo?.h1?.count ?? 0,
    canonical: audit.seo?.canonical?.present ? 'Present' : 'Missing',
    og: audit.seo?.openGraph?.present ? 'Present' : 'Missing',
    structuredData: audit.seo?.structuredData?.present
      ? `Type: ${audit.seo.structuredData.type || 'unknown'}`
      : 'None detected',
    sitemap: audit.seo?.sitemap?.present ? 'Present' : 'Missing',
    robots: audit.seo?.robotsTxt?.present ? 'Present' : 'Missing',
    dupTitle: audit.seo?.duplicateTitle ? 'YES' : 'None',
    dupDesc: audit.seo?.duplicateDescription ? 'YES' : 'None',
    internalLinks: audit.links?.totalInternal ?? 0,
    brokenInternal: audit.links?.brokenInternal ?? 0,
    brokenExternal: audit.links?.brokenExternal ?? 0,
    redirectChains: audit.links?.redirectChains?.length ?? 0,
    orphans: audit.links?.orphanPages?.length ?? 0,
    dTypography: design.typography ?? 65,
    dColor: design.color ?? 65,
    dSpacing: design.spacing ?? 65,
    dLayout: design.layout ?? 70,
    dInteraction: design.interaction ?? 60,
    dConsistency: design.consistency ?? 70,
    dPolish: design.polish ?? 55,
    a11yTotal: audit.accessibility?.violations?.length ?? 0,
    a11yCritical: audit.accessibility?.violations?.filter((v: any) => v.impact === 'critical').length ?? 0,
    hsts: audit.security?.hsts?.present ? 'Present' : 'MISSING',
    csp: audit.security?.csp?.present ? 'Present' : 'MISSING',
    xfo: audit.security?.xFrameOptions?.present ? 'Present' : 'MISSING',
    pagesCrawled: audit.pagesCrawled ?? 0,
    redFlags: redFlagsContext,
    ctaCount: c.ctaCount ?? 0,
    trustSignals: c.trustSignalCount ?? 0,
    socialLinks: c.socialLinks ?? 0,
    contact: c.hasPhone || c.hasEmail ? 'Yes' : 'None',
    forms: c.formCount > 0 ? `Yes (${c.formCount})` : 'None',
    pricing: c.hasPricing ? 'Present' : 'Not found',
    favicon: c.hasFavicon ? 'Present' : 'Missing',
    cms: c.detectedCMS || 'Unknown',
    stockPhotos: c.hasStockPhotos ? 'Yes' : 'No',
    placeholder: c.hasPlaceholderText ? 'YES — live text' : 'None',
  };
}

export async function POST(req: NextRequest) {
  const requestId = Math.random().toString(36).substring(2, 8);
  console.log(`[ENRICH:${requestId}] Starting enrichment request`);

  try {
    const body = await req.json();
    const { lead, audit } = body;

    console.log(`[ENRICH:${requestId}] Received lead: ${lead?.name}, audit overallScore: ${audit?.overallScore}`);

    if (!process.env.GOOGLE_API_KEY) {
      console.error(`[ENRICH:${requestId}] Google API Key not configured`);
      return NextResponse.json({ error: 'Google API Key not configured' }, { status: 500 });
    }

    if (!lead || !audit) {
      console.error(`[ENRICH:${requestId}] Missing lead or audit data`);
      return NextResponse.json({ error: 'Missing lead or audit data' }, { status: 400 });
    }

    const ctx = extractContext(lead, audit);

    const prompt = buildPrompt(ctx);

    const parts: Part[] = [{ text: prompt }];

    // Add screenshots for visual context
    if (audit.screenshotDesktop) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: audit.screenshotDesktop
        }
      });
    }
    if (audit.screenshotMobile) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: audit.screenshotMobile
        }
      });
    }

    // Retry loop for model invocation with exponential backoff
    let result: any = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: MODEL_ID });
        result = await model.generateContent(parts);
        break; // success
      } catch (e: any) {
        lastError = e;
        const isRetryable = e.message?.includes('503') ||
          e.message?.includes('overloaded') ||
          e.message?.includes('unavailable') ||
          e.message?.includes('UNAVAILABLE');
        if (attempt < MAX_RETRIES && isRetryable) {
          console.warn(`Enrichment attempt ${attempt} failed (${e.message}), retrying in ${RETRY_DELAY_MS}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        throw e;
      }
    }

    if (!result) {
      throw lastError || new Error('Failed to generate enrichment after retries');
    }
    const response = await result.response;
    const text = response.text();

    try {
      // Find the first { and last } to extract JSON even if there's preamble/postamble
      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');

      if (startIdx === -1 || endIdx === -1) {
        throw new Error('No JSON found in response');
      }

      const jsonStr = text.substring(startIdx, endIdx + 1);
      const enrichment = JSON.parse(jsonStr);

      // Validate enriched required fields
      const safeEnrichment = {
        summary: enrichment.summary || 'Site audit completed. No AI summary available.',
        strengths: Array.isArray(enrichment.strengths) ? enrichment.strengths : [],
        weaknesses: Array.isArray(enrichment.weaknesses) ? enrichment.weaknesses : [],
        criticalIssues: Array.isArray(enrichment.criticalIssues) ? enrichment.criticalIssues : [],
        quickWins: Array.isArray(enrichment.quickWins) ? enrichment.quickWins : [],
        suggestedCopyEdits: Array.isArray(enrichment.suggestedCopyEdits) ? enrichment.suggestedCopyEdits : [],
        designScore: clampScore(enrichment.designScore),
        uxScore: clampScore(enrichment.uxScore),
        conversionScore: clampScore(enrichment.conversionScore),
        trustScore: clampScore(enrichment.trustScore),
        overallScore: clampScore(enrichment.overallScore),
        timestamp: Date.now()
      };

      return NextResponse.json({ enrichment: safeEnrichment });
    } catch (parseError: any) {
      console.error('Gemini JSON Parse Error:', parseError);
      console.error('Raw text from Gemini:', text);
      return NextResponse.json({
        error: 'Failed to parse AI response',
        rawText: text
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Enrichment route error:', error);
    return NextResponse.json({
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
}

function clampScore(v: any, min = 0, max = 100): number {
  const n = Number(v);
  return isNaN(n) ? 50 : Math.max(min, Math.min(max, Math.round(n)));
}

function buildPrompt(ctx: ReturnType<typeof extractContext>): string {
  return `You are a senior web audit consultant with 15+ years of cross-functional experience in UX design, frontend architecture, conversion-rate optimization, and technical SEO. You are reviewing a live screenshot and a full technical audit report for a local business website.

## Your Role
Evaluate this site the way a real consultant would — with specificity, evidence-based reasoning, and no generic filler. Your scores must be internally consistent. If a site has major design issues (cluttered layout, broken hierarchy, generic stock photography), it cannot receive a 9/10 design score. If conversion signals are absent (no CTA, no contact info), conversion score must reflect that. If subscores suggest a weak site, overall must be weak as well.

---

## Data Provided

### Business Context
- Name: ${ctx.name}
- Website: ${ctx.website}
- Industry: ${ctx.industry}
- Rating: ${ctx.rating}/5 (${ctx.reviews} reviews)
- Location: ${ctx.address}

### Technical Audit Scores (0–100)
- Overall: ${ctx.overall}
- Performance: ${ctx.perf} (LCP ${ctx.lcp}s, CLS ${ctx.cls}, INP ${ctx.inp})
- SEO: ${ctx.seo}
- Accessibility: ${ctx.a11y} (${ctx.a11yTotal} violations, ${ctx.a11yCritical} critical)
- Security: ${ctx.security} (HSTS: ${ctx.hsts}, CSP: ${ctx.csp}, XFO: ${ctx.xfo})
- Design: ${ctx.designScore}

### Core Web Vitals
LCP: ${ctx.lcp}s | CLS: ${ctx.cls} | INP: ${ctx.inp} | FCP: ${ctx.fcp} | TTFB: ${ctx.ttfb}

### SEO Analysis
- Title: ${ctx.title}
- Meta Description: ${ctx.meta}
- H1 Tags: ${ctx.h1Count} found
- Canonical: ${ctx.canonical}
- Open Graph: ${ctx.og}
- Structured Data: ${ctx.structuredData}
- Sitemap.xml: ${ctx.sitemap}
- Robots.txt: ${ctx.robots}
- Duplicate Titles: ${ctx.dupTitle} | Duplicate Descriptions: ${ctx.dupDesc}

### Link Health
- Internal Links: ${ctx.internalLinks}
- Broken Internal: ${ctx.brokenInternal}
- Broken External: ${ctx.brokenExternal}
- Redirect Chains: ${ctx.redirectChains}
- Orphan Pages: ${ctx.orphans}

### Design Breakdown
Typography: ${ctx.dTypography} | Color: ${ctx.dColor} | Spacing: ${ctx.dSpacing} | Layout: ${ctx.dLayout} | Interaction: ${ctx.dInteraction} | Consistency: ${ctx.dConsistency} | Polish: ${ctx.dPolish}

### Pages Crawled: ${ctx.pagesCrawled}

### Red Flags
${ctx.redFlags}

---

## Conversion Analysis
- CTAs: ${ctx.ctaCount} | Trust signals: ${ctx.trustSignals} | Social links: ${ctx.socialLinks}
- Contact visible: ${ctx.contact} | Forms: ${ctx.forms} | Pricing: ${ctx.pricing}
- Favicon: ${ctx.favicon} | CMS: ${ctx.cms} | Stock photos: ${ctx.stockPhotos} | Placeholder text: ${ctx.placeholder}

---

## Screenshots
You will receive two full-page screenshots: desktop (1280px wide) and mobile (375px wide).

---

## Instructions

1. **SCREENSHOT IS PRIMARY SOURCE.** Your visual evaluation takes priority over any single number. Pay attention to both desktop AND mobile screenshots — mobile tells a very different story for conversion.

2. **BE CONCRETE AND SPECIFIC.** Name things you actually see: "hero image is a stock photo with no caption", "CTA is below the fold", "secondary nav has 12 items", "paragraphs are 31 words long on average with no headers".

3. **SCORE HONESTLY.** A 75 is a solid B, not a barely-passing grade. A 90 is genuinely excellent across every dimension. Most small business sites score 45–65 after hard audit. Never inflate to help the user — honesty is more valuable than fluff.

4. **SCORES MUST BE INTERNALLY CONSISTENT.**
   - If design looks outdated or generic → designScore ≤ 65.
   - If no CTAs visible in screenshot → conversionScore ≤ 40.
   - If broken link count > 5 → weaknesses and quickWins must mention links.
   - If 2 or more subscores are below 50 → overall cannot be above 65.
   - Never mark something a Quick Win if it needs a full redesign.

5. **NO GENERIC PHRASES.** Replace "could benefit from", "consider", or "may want to" with direct statements like "Missing typeface contrast makes body text hard to scan" or "Call-to-action is invisible on mobile — 90% of visitors never see it".

6. **OUTPUT FORMAT — strict JSON, no markdown code fences:**

{
  "summary": "string",
  "strengths": ["specific positive findings", "each must reference screenshot or audit data"],
  "weaknesses": ["specific negative findings tied to the data"],
  "criticalIssues": ["at most 3 items: genuinely urgent things damaging the business right now"],
  "quickWins": ["at most 4 items: specific fixes requiring <=4 hours with meaningful impact"],
  "suggestedCopyEdits": ["specific headline or CTA copy rewrites; omit entirely if copy is strong; empty array [] if no rewrites needed"],
  "designScore": 0–100,
  "uxScore": 0–100,
  "conversionScore": 0–100,
  "trustScore": 0–100,
  "overallScore": 0–100
}

7. **SCORING DEFINITIONS:**

- designScore: Typography hierarchy (font choices, size contrast, readability), color palette coherence and WCAG legibility, spacing rhythm and alignment consistency, layout balance across sections, mobile layout coherence, quality of images used, brand consistency between desktop and mobile views. Reference specific visual observations from screenshots.

- uxScore: Ease of navigation (can a new user find what they want in ≤30 seconds?), information density and scanability, cognitive load, mobile touch target sizes and spacing, form/usability clarity, visual feedback on interactive states, accessibility surface from both automated scan and visible issues in screenshots.

- conversionScore: Clarity of primary CTA and where it sits in above-fold real estate, presence and quality of trust signals (testimonials, credentials, guarantees), phone/email/contact form visibility, offer clarity and specificity, urgency or incentive messaging, social proof presence, lead-capture quality, friction in the funnel (do users need to guess what to do next?).

- trustScore: Strength of brand identity (logo, imagery, voice quality), professionalism of layout and copy, transparency (physical address, clear About, privacy policy), review/testimonial availability and placement, HTTPS and security perception from the user view, consistency between what the site promises and what it shows.

- overallScore: Weighted aggregate reflecting the site's real readiness today. If 2+ subscores are below 55, overall must also be below 55. If no critical red flags and subscores are 70+ range, an 80+ overall is defensible. Round to nearest integer.

8. **FORBIDDEN PATTERNS (do not do these):**
- Do not inflate scores to be reassuring — score the site honestly.
- Do not repeat the same finding across 3 fields — be precise.
- Do not use phrases like "would benefit from", "should consider", "may want to" — use direct statements.
- Do not return barely-differentiated scores — if subscores differ by less than 5 points, justify why.
- Do not output anything other than the JSON object — no markdown fences, no preface, no notes.`;
}
