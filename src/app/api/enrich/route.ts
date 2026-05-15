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

    // Build rich context from comprehensive audit
    const redFlagsContext = audit.redFlags?.length
      ? audit.redFlags.map((f: any) => `[${f.severity.toUpperCase()}] ${f.message} (${f.category})`).join('\n')
      : 'No critical issues detected.';

    // Build conversion/structural context
    const convCtx = audit.conversion?.raw;
    const conversionCtx = convCtx ? `
**Conversion Analysis:**
- Call-to-Action buttons: ${convCtx.ctaCount || 0}
- Trust signals found: ${convCtx.trustSignalCount || 0}
- Social media links: ${convCtx.socialLinks || 0}
- Contact info visible: ${convCtx.hasPhone || convCtx.hasEmail ? 'Yes' : 'No'}
- Contact form: ${convCtx.formCount > 0 ? 'Yes (' + convCtx.formCount + ' forms)' : 'None'}
- Pricing info: ${convCtx.hasPricing ? 'Present' : 'Not found'}
- Favicon: ${convCtx.hasFavicon ? 'Present' : 'Missing'}
- CMS detected: ${convCtx.detectedCMS || 'Unknown'}
- Stock photos: ${convCtx.hasStockPhotos ? 'Yes' : 'No'}
- Placeholder/lorem text: ${convCtx.hasPlaceholderText ? 'YES — found on site' : 'None'}
` : '';

    // Design breakdown
    const designCtx = audit.design ? `
**Design Score Breakdown:**
- Typography: ${audit.design.typography}/100
- Color scheme: ${audit.design.color}/100
- Spacing: ${audit.design.spacing}/100
- Layout: ${audit.design.layout}/100
- Interaction/animations: ${audit.design.interaction}/100
- Consistency: ${audit.design.consistency}/100
- Polish: ${audit.design.polish}/100
` : '';

    const webVitals = audit.webVitals?.mobile || audit.webVitals?.desktop;
    const cwvStatus = webVitals
      ? `LCP: ${(webVitals.lcp / 1000).toFixed(1)}s, CLS: ${webVitals.cls.toFixed(3)}, INP: ${webVitals.inp}ms`
      : 'Not available';

    const prompt = `
You are an elite Sales Intelligence Agent for a web development agency.

## Business Context
- Business: ${lead.name}
- Website: ${lead.website}
- Industry: ${lead.category || 'Unknown'}
- Rating: ${lead.rating}/5 (${lead.reviews} reviews)
- Location: ${lead.address || 'Not specified'}

## Technical Audit Results (Comprehensive)
**Overall Health Score: ${audit.overallScore}/100**
  - Performance: ${audit.performanceScore}/100
  - SEO: ${audit.seoScore}/100
  - Accessibility: ${audit.accessibilityScore}/100
  - Security: ${audit.securityScore}/100
  - Design: ${audit.designScore}/100

**Core Web Vitals (Mobile):**
${cwvStatus}

**SEO Analysis:**
- Title: ${audit.seo.title.present ? `"${audit.seo.title.value}" (${audit.seo.title.length} chars)` : 'MISSING'}
- Meta Description: ${audit.seo.metaDescription.present ? `"${audit.seo.metaDescription.value}"` : 'MISSING'}
- H1 Tags: ${audit.seo.h1.count} found
- Canonical: ${audit.seo.canonical.present ? 'Present' : 'Missing'}
- Open Graph: ${audit.seo.openGraph.present ? 'Present' : 'Missing'}
- Structured Data: ${audit.seo.structuredData.present ? `Type: ${audit.seo.structuredData.type}` : 'None detected'}
- Sitemap.xml: ${audit.seo.sitemap.present ? 'Present' : 'Missing'}
- Robots.txt: ${audit.seo.robotsTxt.present ? 'Present' : 'Missing'}
- Duplicate Issues: ${audit.seo.duplicateTitle ? 'Duplicate titles found' : 'None'} | ${audit.seo.duplicateDescription ? 'Duplicate descriptions' : 'None'}

**Link Health:**
- Internal Links: ${audit.links.totalInternal}
- Broken Internal: ${audit.links.brokenInternal}
- Broken External: ${audit.links.brokenExternal}
- Redirect Chains: ${audit.links.redirectChains.length}
- Orphan Pages: ${audit.links.orphanPages.length}

**Design Score Breakdown (0-100):**
- Typography: ${audit.design.typography} | Color: ${audit.design.color} | Spacing: ${audit.design.spacing}
- Layout: ${audit.design.layout} | Interaction: ${audit.design.interaction} | Consistency: ${audit.design.consistency} | Polish: ${audit.design.polish}

**Accessibility Violations:**
- Total violations: ${audit.accessibility.violations.length}
- Critical: ${audit.accessibility.violations.filter((v: any) => v.impact === 'critical').length}
- Missing lang attribute: ${!audit.accessibility.langAttribute ? 'YES' : 'No'}
- Missing viewport meta: ${!audit.accessibility.viewportMeta ? 'YES' : 'No'}

**Security Headers:**
- HSTS: ${audit.security.hsts.present ? 'Present' : 'MISSING'} | CSP: ${audit.security.csp.present ? 'Present' : 'MISSING'}
- X-Frame-Options: ${audit.security.xFrameOptions.present ? 'Present' : 'MISSING'}

**Pages Crawled:** ${audit.pagesCrawled}

---

## Red Flags Detected:
${redFlagsContext || 'None — site is in good shape.'}

---

## Visual Analysis (use the full-page desktop screenshot provided):

Look at the website screenshot CAREFULLY and evaluate:

1. **Visual Design Quality (1-10):**
   - Is the design modern or outdated? Professional or DIY?
   - Does it look like a custom-built site or a generic template?
   - Are colors, fonts, and style consistent?
   - Is there a clear visual hierarchy (headings → sections → CTAs)?

2. **Content & Copy Quality (1-10):**
   - Is the value proposition clear within 3 seconds?
   - Are headings descriptive and benefit-driven?
   - Is the text well-written or generic/filler?
   - Any placeholder text, lorem ipsum, or under construction signs?

3. **Mobile Readiness (from what you can see):**
   - Does the layout work at smaller viewports?
   - Are buttons appropriately sized?
   - Is text readable?

4. **Conversion Design (Present/Not Present):**
   - Are there clear Call-to-Action buttons?
   - Trust signals visible (testimonials, reviews, certifications, logos)?
   - Contact info easy to find?
   - Is there social proof (social media follow counts, client counts)?
   - Does the site make you want to take action?

5. **Specific Red Flags:**
   - Stock photos that look generic
   - Broken images or missing content
   - Too much text without structure
   - Slow-feeling design (heavy images, too many animations)
   - Outdated design patterns (gradients from 2010, skeuomorphism)
   - Missing or weak calls-to-action

## Your Task:

Analyze ALL of the above (technical data + screenshots) and provide:

1. **Executive Summary** (2-3 sentences): Objective assessment of the business's digital presence. Include both technical health AND visual/design quality observations. Be specific, not generic.

2. **Risk Factors** (3-5 items): Specific technical OR visual business vulnerabilities that could cost them money/customers. Mix technical issues (e.g., "47 broken links = lost SEO equity") with design issues (e.g., "generic stock photography makes the site feel unprofessional").

3. **Value Gaps** (3-5 items): Where they're losing revenue, traffic, or conversions. Include both technical (e.g., "LCP of 3.2s likely costs ~18% of mobile conversions") and design-related losses (e.g., "Weak CTA placement means visitors don't know how to book").

4. **Sales Hooks** (3-5 items): Personalized, data-backed opening lines for cold outreach. Reference SPECIFIC things you saw in the screenshot + audit data. Make them sound like a human sales rep who actually visited the site, not a generic template.

5. **Competitive Position** (1-2 sentences): How this site compares to industry standards. Be specific about what's above/below average.

6. **Recommended Services** (3-5 items): Based on BOTH technical issues and visual observations, what would you actually sell? (e.g., "Performance Optimization", "SEO Overhaul", "UI Redesign", "Content Rewrite", "Conversion Optimization", "Accessibility Compliance").

7. **Priority**: low / medium / high — based on overall urgency.

Output ONLY valid JSON:
{
  "summary": "string",
  "riskFactors": ["string"],
  "valueGaps": ["string"],
  "salesHooks": ["string"],
  "competitivePosition": "string",
  "recommendedServices": ["string"],
  "priority": "low" | "medium" | "high"
}
`;

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

      // Add timestamp and ensure structure
      const enrichedData = {
        ...enrichment,
        timestamp: Date.now()
      };

      return NextResponse.json({ enrichment: enrichedData });
    } catch (parseError) {
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
