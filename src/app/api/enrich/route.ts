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

## Your Task:

Analyze the data above and provide:

1. **Executive Summary** (2 sentences): Objective assessment of the business's digital presence. If the site is well-optimized, acknowledge strengths first.

2. **Risk Factors** (3-5 items): Specific technical or business vulnerabilities that could cost them money/customers. Reference actual numbers (e.g., "47 broken links = lost SEO equity").

3. **Value Gaps** (3-5 items): Where they're losing revenue, traffic, or conversions compared to a fully optimized site. Quantify where possible (e.g., "LCP of 3.2s likely costs ~18% of mobile conversions").

4. **Sales Hooks** (3-5 items): Personalized, data-backed opening lines for cold outreach. Make them specific to this business's actual audit results. Write as complete sentences the sales rep can copy-paste.

5. **Competitive Position**: One sentence on how this site compares to industry benchmarks (e.g., "Below average for local service sites" or "Competitive with market leaders").

6. **Recommended Services**: Based on the audit, which services would you actually sell? (e.g., "Performance Optimization", "SEO Overhaul", "Accessibility Compliance", "Security Hardening", "Full Redesign").

7. **Priority**: low / medium / high — based on urgency and revenue impact.

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
