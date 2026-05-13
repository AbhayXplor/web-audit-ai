import { NextRequest, NextResponse } from 'next/server';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { chromium } from 'playwright';
import { resolve } from 'path';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  let browser = null;
  let extractedData: any = {};

  try {
    const { url, depth = 1, maxPages = 3 } = await req.json();
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    console.log(`[AUDIT] Starting: ${normalizedUrl} (depth:${depth}, maxPages:${maxPages})`);

    // === STEP 1: Run site-audit CLI ===
    let siteAudit: any = null;
    let siteAuditError: string | null = null;

    try {
      // Try using the local .cmd binary directly (faster, no npx overhead)
      const binPath = resolve(process.cwd(), 'node_modules', '@benven', 'site-audit', 'dist', 'cli.js');
      const { stdout } = await execFileAsync(process.execPath, [binPath, 'audit', normalizedUrl, '--json', '--depth', String(depth), '--max-pages', String(maxPages), '--no-robots', '--ci'], {
        timeout: 240000,
        maxBuffer: 50 * 1024 * 1024,
        cwd: process.cwd()
      });
      const jsonStr = extractJson(stdout);
      siteAudit = JSON.parse(jsonStr);
      console.log(`[AUDIT] CLI succeeded. Pages: ${siteAudit.crawl?.totalPages || 0}`);
    } catch (e1: any) {
      console.log(`[AUDIT] Direct CLI failed: ${e1.message}. Trying npx...`);
      try {
        // Fallback: try npx (works if npm is configured)
        const { stdout } = await execAsync(`npx --yes @benven/site-audit audit "${normalizedUrl}" --json --depth ${depth} --max-pages ${maxPages} --no-robots --ci`, {
          timeout: 240000,
          maxBuffer: 50 * 1024 * 1024,
          cwd: process.cwd()
        });
        const jsonStr = extractJson(stdout);
        siteAudit = JSON.parse(jsonStr);
        console.log(`[AUDIT] npx succeeded. Pages: ${siteAudit.crawl?.totalPages || 0}`);
      } catch (e2: any) {
        // Try to extract JSON from error stdout (non-zero exit but valid JSON)
        let recovered = false;
        if (e2.stdout && typeof e2.stdout === 'string') {
          try {
            const jsonStr = extractJson(e2.stdout);
            if (jsonStr && jsonStr.startsWith('{')) {
              siteAudit = JSON.parse(jsonStr);
              console.log(`[AUDIT] Recovered JSON from error stdout. Pages: ${siteAudit.crawl?.totalPages || 0}`);
              recovered = true;
            }
          } catch { }
        }
        if (!recovered) {
          siteAuditError = `site-audit failed: ${e1.message}`;
          console.log('[AUDIT] Both CLI and npx failed. Will use Playwright fallback.');
        }
      }
    }

    // === STEP 2: Screenshots + page data (always run) ===
    let screenshotDesktop = '', screenshotMobile = '';

    try {
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

      // Desktop
      const dp = await browser.newPage();
      await dp.setViewportSize({ width: 1280, height: 800 });
      const pageResponse = await dp.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      extractedData = await dp.evaluate(() => ({
        title: document.title,
        metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        h1Count: document.querySelectorAll('h1').length,
        hasCanonical: !!document.querySelector('link[rel="canonical"]'),
        hasOpenGraph: document.querySelectorAll('meta[property^="og:"]').length > 0,
        hasLang: !!document.documentElement.getAttribute('lang'),
        hasViewport: !!document.querySelector('meta[name="viewport"]'),
        internalLinks: Array.from(document.querySelectorAll('a')).filter(a => a.href && a.href.startsWith(window.location.origin)).length,
        externalLinks: Array.from(document.querySelectorAll('a')).filter(a => a.href && !a.href.startsWith(window.location.origin) && !a.href.startsWith('javascript')).length
      }));

      const headers = pageResponse?.headers() || {};
      extractedData.headers = {
        hsts: !!headers['strict-transport-security'],
        csp: !!headers['content-security-policy'],
        xfo: !!headers['x-frame-options'],
        xcto: !!headers['x-content-type-options']
      };

      await dp.waitForTimeout(1500);
      screenshotDesktop = (await dp.screenshot({ type: 'jpeg', quality: 50 })).toString('base64');
      await dp.close();

      // Mobile
      const mp = await browser.newPage();
      await mp.setViewportSize({ width: 375, height: 667 });
      await mp.goto(normalizedUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await mp.waitForTimeout(1500);
      screenshotMobile = (await mp.screenshot({ type: 'jpeg', quality: 50 })).toString('base64');
      await mp.close();
    } catch (e) {
      console.error('[AUDIT] Screenshot error:', e);
    } finally {
      if (browser) try { await browser.close(); } catch { }
    }

    // === STEP 3: PSI API (quick) ===
    let psiData: any = null;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(normalizedUrl)}&strategy=mobile`, { signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) psiData = await r.json();
    } catch { }

    // === STEP 4: Build audit ===
    let audit: any;
    if (siteAuditError || !siteAudit) {
      console.log('[AUDIT] Using enhanced fallback with extracted data');
      audit = createFallbackAudit(normalizedUrl, extractedData);
    } else {
      console.log('[AUDIT] Building audit from site-audit data');
      audit = buildAudit(siteAudit, { screenshotDesktop, screenshotMobile, psiData });
    }

    // Attach screenshots (at the end after buildAudit has processed data)
    if (screenshotDesktop) audit.screenshotDesktop = screenshotDesktop;
    if (screenshotMobile) audit.screenshotMobile = screenshotMobile;

    return NextResponse.json({ audit });
  } catch (error: any) {
    console.error('[AUDIT] Fatal error:', error);
    return NextResponse.json({
      error: error.message,
      details: error.stack,
      audit: createFallbackAudit('unknown', extractedData || {})
    }, { status: 500 });
  }
}

// ====== EXISTING FUNCTIONS (unchanged) ======

function buildAudit(siteAudit: any, opts: { screenshotDesktop: string; screenshotMobile: string; psiData: any }): any {
  const now = Date.now();
  if (!siteAudit) return createFallbackAudit('unknown');

  const psi = opts.psiData?.lighthouseResult;
  const psiAudits = psi?.audits || {};

  let lcp = 0, cls = 0, inp = 0, fcp = 0, ttfb = 0;
  const cwv = siteAudit.lighthouse?.cwvSummary?.p50 || siteAudit.lighthouse?.pages?.[0]?.cwv;
  if (cwv) { lcp = cwv.lcp || 0; cls = cwv.cls || 0; inp = cwv.inp || 0; fcp = cwv.fcp || 0; ttfb = cwv.ttfb || 0; }
  if (lcp === 0 && psiAudits['largest-contentful-paint']) {
    lcp = psiAudits['largest-contentful-paint'].numericValue || 0;
    cls = psiAudits['cumulative-layout-shift']?.numericValue || 0;
    fcp = psiAudits['first-contentful-paint']?.numericValue || 0;
    ttfb = psiAudits['server-response-time']?.numericValue || 0;
  }
  if (lcp === 0 && siteAudit.crawl?.pages) {
    const pages = Array.isArray(siteAudit.crawl.pages) ? siteAudit.crawl.pages : Array.from(siteAudit.crawl.pages.values() || []);
    const avgResponse = pages.reduce((acc: number, p: any) => acc + (p.responseTime || 0), 0) / (pages.length || 1);
    ttfb = avgResponse; lcp = avgResponse * 2.5;
  }

  let perfScore = 0;
  const rawPerfScore = siteAudit.lighthouse?.pages?.[0]?.performanceScore ?? psi?.categories?.performance?.score;
  if (rawPerfScore !== undefined) {
    perfScore = rawPerfScore <= 1 ? Math.round(rawPerfScore * 100) : Math.round(rawPerfScore);
  } else if (lcp > 0) {
    if (lcp < 1200) perfScore = 95; else if (lcp < 2500) perfScore = 80; else if (lcp < 4000) perfScore = 50; else perfScore = 30;
  } else { perfScore = 50; }

  const seoPages = siteAudit.seo?.pages || [];
  const firstPage = seoPages[0] || {};
  const pageIssues = seoPages.flatMap((p: any) => p.issues || []);
  const siteLevelIssues = siteAudit.siteLevel?.issues || [];
  const allIssues = [...pageIssues, ...siteLevelIssues];
  const titles = seoPages.map((p: any) => p.title).filter(Boolean);
  const descriptions = seoPages.map((p: any) => p.metaDescription).filter(Boolean);
  const duplicateTitle = titles.length > new Set(titles).size;
  const duplicateDesc = descriptions.length > new Set(descriptions).size;
  const thinContent = allIssues.some((i: any) => i.rule === 'thin-content');
  const totalH1 = seoPages.reduce((a: number, p: any) => a + (p.h1Count || 0), 0);
  const hasCanonical = firstPage.canonicalUrl !== null;
  const hasOpenGraph = !firstPage.issues?.some((i: any) => i.rule.startsWith('og-') && i.rule.endsWith('-missing'));
  const structuredDataPresent = !firstPage.issues?.some((i: any) => i.rule === 'structured-data-missing');
  const sitemapMissing = siteLevelIssues.some((i: any) => i.rule === 'sitemap-xml-missing');
  const robotsTxtMissing = siteLevelIssues.some((i: any) => i.rule === 'robots-txt-missing');
  const robotsTxtDisallowAll = siteLevelIssues.some((i: any) => i.rule === 'robots-txt-disallow-all');

  const pagesRaw = siteAudit.crawl?.pages;
  const pages = Array.isArray(pagesRaw) ? pagesRaw : (pagesRaw?.values ? Array.from(pagesRaw.values()) : []);
  const totalInternal = pages.reduce((a: number, p: any) => a + (p.outgoingLinks?.length || 0), 0);
  const brokenInternal = pages.filter((p: any) => p.statusCode >= 400 && p.statusCode < 600).length;
  const brokenExternal = siteAudit.externalLinks?.broken || 0;
  const totalExternal = siteAudit.externalLinks?.checked || 0;
  const redirectChains = (siteAudit.crawl?.redirectChains || []).map((rc: any) => ({ from: rc.from, to: rc.chain[rc.chain.length - 1], hops: rc.chain.length }));
  const orphanPages = siteAudit.crawl?.orphanPages || [];

  const a11yIssues = siteAudit.accessibility?.issues || [];
  let a11yScore = 0;
  const rawA11yScore = psi?.categories?.accessibility?.score;
  if (rawA11yScore !== undefined) { a11yScore = Math.round(rawA11yScore * 100); } else {
    a11yScore = Math.max(0, Math.min(100, 100 - a11yIssues.filter((i: any) => i.severity === 'error' || i.severity === 'critical').length * 8 - a11yIssues.filter((i: any) => i.severity === 'warning' || i.severity === 'serious').length * 3));
    if (a11yScore === 100 && a11yIssues.length === 0 && !siteAudit.accessibility) a11yScore = 70;
  }
  const langMissing = allIssues.some((i: any) => i.rule === 'html-lang-missing');
  const viewportMissing = allIssues.some((i: any) => i.rule === 'viewport-missing');
  const hasHsts = !siteLevelIssues.some((i: any) => i.rule === 'security-hsts-missing');
  const hasCsp = !siteLevelIssues.some((i: any) => i.rule === 'security-csp-missing');
  const hasXfo = !siteLevelIssues.some((i: any) => i.rule === 'security-x-frame-missing');
  const hasXcto = !siteLevelIssues.some((i: any) => i.rule === 'security-x-content-type-missing');
  const securityScore = (hasHsts && hasCsp && hasXfo) ? 90 : (hasHsts || hasCsp) ? 70 : 50;
  const designScore = 65;
  const designBreakdown = { overall: 65, typography: 70, color: 60, spacing: 65, layout: 70, interaction: 60, consistency: 75, polish: 55 };

  let seoScore = 0;
  const rawSeoScore = psi?.categories?.seo?.score;
  if (rawSeoScore !== undefined) { seoScore = Math.round(rawSeoScore * 100); } else {
    const errorCount = allIssues.filter((i: any) => i.severity === 'error').length;
    const warningCount = allIssues.filter((i: any) => i.severity === 'warning').length;
    const infoCount = allIssues.filter((i: any) => i.severity === 'info').length;
    seoScore = Math.max(0, Math.min(100, 100 - errorCount * 5 - warningCount * 2 - infoCount * 0.5));
    if (seoScore === 100 && allIssues.length === 0 && !siteAudit.seo) seoScore = 70;
  }

  const overallScore = Math.min(100, Math.round(perfScore * 0.30 + seoScore * 0.25 + a11yScore * 0.20 + securityScore * 0.15 + designScore * 0.10));

  const redFlags: any[] = [];
  const topFixes = siteAudit.rankedFixes || [];
  for (const fix of topFixes.slice(0, 10)) {
    const severity = fix.impact === 'high' ? 'critical' : fix.impact === 'medium' ? 'high' : 'medium';
    if (severity === 'critical' || severity === 'high') redFlags.push({ severity, category: fix.category, message: fix.title, impact: fix.description, affectedUrls: fix.affectedUrls?.slice(0, 5) || [] });
  }
  if (lcp > 4000) redFlags.unshift({ severity: 'critical', category: 'performance', message: `LCP ${(lcp / 1000).toFixed(1)}s — extremely slow`, impact: 'High bounce, Google penalty' });
  if (brokenInternal > 20) redFlags.unshift({ severity: 'critical', category: 'links', message: `${brokenInternal} broken internal links`, impact: 'Lost equity, crawl waste' });
  if (!hasHsts) redFlags.unshift({ severity: 'critical', category: 'security', message: 'Missing HSTS header', impact: 'Security risk, SEO downgrade' });
  if (robotsTxtDisallowAll) redFlags.unshift({ severity: 'critical', category: 'seo', message: 'robots.txt blocks all crawlers', impact: 'Zero search visibility' });
  if (lcp > 2500) redFlags.push({ severity: 'high', category: 'performance', message: `LCP ${(lcp / 1000).toFixed(1)}s — should be <2.5s`, impact: '18% higher bounce per 1s' });
  if (inp > 200) redFlags.push({ severity: 'high', category: 'performance', message: `INP ${inp}ms — poor interactivity`, impact: 'User frustration' });
  if (!hasOpenGraph) redFlags.push({ severity: 'high', category: 'seo', message: 'Missing Open Graph tags', impact: 'Poor social sharing' });
  if (!structuredDataPresent) redFlags.push({ severity: 'high', category: 'seo', message: 'No structured data', impact: 'No rich snippets' });
  if (duplicateTitle) redFlags.push({ severity: 'high', category: 'seo', message: 'Duplicate page titles', impact: 'Keyword cannibalization' });
  if (a11yScore < 70) redFlags.push({ severity: 'high', category: 'accessibility', message: `Accessibility score ${a11yScore}/100`, impact: 'ADA compliance risk' });
  if (perfScore < 70) redFlags.push({ severity: 'medium', category: 'performance', message: `Performance ${perfScore}/100 needs work`, impact: 'Suboptimal UX' });
  if (seoScore < 70) redFlags.push({ severity: 'medium', category: 'seo', message: `SEO score ${seoScore}/100`, impact: 'Lower rankings' });
  if (sitemapMissing) redFlags.push({ severity: 'medium', category: 'seo', message: 'No sitemap.xml', impact: 'Slower indexing' });
  if (totalH1 === 0) redFlags.push({ severity: 'medium', category: 'seo', message: 'Missing H1 on homepage', impact: 'Poor hierarchy' });

  const seen = new Set<string>();
  const uniqueFlags = redFlags.filter(f => { if (seen.has(f.message)) return false; seen.add(f.message); return true; });

  return {
    performanceScore: Math.min(100, Math.max(0, perfScore)),
    seoScore: Math.min(100, Math.max(0, seoScore)),
    accessibilityScore: Math.min(100, Math.max(0, a11yScore)),
    securityScore: Math.min(100, Math.max(0, securityScore)),
    designScore: Math.min(100, Math.max(0, designScore)),
    overallScore,
    overallGrade: getGrade(overallScore), performanceGrade: getGrade(perfScore), seoGrade: getGrade(seoScore), accessibilityGrade: getGrade(a11yScore), securityGrade: getGrade(securityScore),
    recommendations: getRecommendations({ overallScore, redFlags: uniqueFlags, links: { brokenInternal }, webVitals: { mobile: { lcp, cls, inp } }, security: { hsts: { present: hasHsts } } }),
    webVitals: { desktop: { lcp, cls, inp, fcp, ttfb }, mobile: { lcp, cls, inp, fcp, ttfb } },
    seo: { title: { present: !!firstPage.title, length: firstPage.title?.length || 0, value: firstPage.title || null }, metaDescription: { present: !!firstPage.metaDescription, length: firstPage.metaDescription?.length || 0, value: firstPage.metaDescription || null }, h1: { present: totalH1 > 0, count: totalH1 }, canonical: { present: hasCanonical, value: firstPage.canonicalUrl || null }, openGraph: { present: hasOpenGraph }, structuredData: { present: structuredDataPresent, type: 'unknown', errors: [] }, robotsTxt: { present: !robotsTxtMissing, content: null }, sitemap: { present: !sitemapMissing, url: null }, duplicateTitle, duplicateDescription: duplicateDesc, thinContent },
    accessibility: { score: a11yScore, violations: a11yIssues.map((i: any) => ({ id: i.rule, impact: mapImpact(i.severity), description: i.message })), langAttribute: !langMissing, viewportMeta: !viewportMissing, altImages: 0, ariaLabels: 0 },
    security: { score: securityScore, hsts: { present: hasHsts, maxAge: 0 }, csp: { present: hasCsp, value: '' }, xFrameOptions: { present: hasXfo, value: '' }, xContentTypeOptions: { present: hasXcto }, referrerPolicy: { present: false, value: '' }, permissionsPolicy: { present: false, value: '' } },
    links: { totalInternal, totalExternal, brokenInternal, brokenExternal, redirectChains, orphanPages },
    design: designBreakdown,
    screenshotDesktop: opts.screenshotDesktop || undefined,
    screenshotMobile: opts.screenshotMobile || undefined,
    pagesCrawled: siteAudit.crawl?.totalPages ?? (pages.length || 1),
    crawlDuration: siteAudit.crawl?.elapsedMs ? Math.round(siteAudit.crawl.elapsedMs / 1000) : 0,
    timestamp: now,
    redFlags: uniqueFlags.slice(0, 10)
  };
}

function mapImpact(severity: string): 'critical' | 'serious' | 'moderate' | 'minor' {
  switch (severity?.toLowerCase()) { case 'error': return 'critical'; case 'warning': return 'serious'; case 'info': return 'moderate'; default: return 'moderate'; }
}

function getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A'; if (score >= 80) return 'B'; if (score >= 70) return 'C'; if (score >= 60) return 'D'; return 'F';
}

function getRecommendations(audit: any): any {
  const overall = audit.overallScore;
  const redFlagCount = audit.redFlags?.filter((f: any) => f.severity === 'critical' || f.severity === 'high').length || 0;
  const brokenLinks = audit.links?.brokenInternal || 0;
  const lcp = audit.webVitals?.mobile?.lcp || 0;
  let priority: 'low' | 'medium' | 'high' | 'critical' = 'low';
  let suggestedServices: string[] = [];
  let expectedImpact: 'low' | 'medium' | 'high' = 'medium';
  let downloadReport = false;
  if (overall >= 80 || (overall >= 70 && redFlagCount === 0 && brokenLinks < 5 && lcp < 2500)) { priority = 'low'; suggestedServices = ['Maintenance & Monitoring']; expectedImpact = 'low'; downloadReport = false; }
  else if (overall >= 70) { priority = 'medium'; suggestedServices = ['Performance Optimization', 'SEO Audit Fixes']; expectedImpact = 'medium'; downloadReport = true; }
  else if (overall >= 60) { priority = 'high'; suggestedServices = ['Technical SEO Overhaul', 'Performance Tuning', 'Accessibility Audit']; expectedImpact = 'high'; downloadReport = true; }
  else { priority = 'critical'; suggestedServices = ['Full Website Redesign', 'Emergency SEO Recovery', 'Performance Rescue']; expectedImpact = 'high'; downloadReport = true; }
  if (lcp > 4000) { priority = 'critical'; suggestedServices.push('Performance Emergency'); expectedImpact = 'high'; }
  if (brokenLinks > 20) { priority = 'critical'; suggestedServices.push('Link Integrity Repair'); }
  if (!audit.security?.hsts?.present) suggestedServices.push('Security Hardening');
  return { downloadReport, priority, suggestedServices: [...new Set(suggestedServices)], expectedImpact, estimatedEffort: expectedImpact === 'high' ? 'high' : 'medium' };
}

function extractJson(stdout: string): string {
  const startIndex = stdout.indexOf('{');
  const endIndex = stdout.lastIndexOf('}');
  if (startIndex === -1 || endIndex === -1) return stdout;
  return stdout.substring(startIndex, endIndex + 1);
}

function createFallbackAudit(url: string, extractedData?: any) {
  let perfScore = 50, seoScore = 50, a11yScore = 50, securityScore = 50;
  const designScore = 60;
  const title = extractedData?.title || '';
  const desc = extractedData?.metaDescription || '';
  const h1Count = extractedData?.h1Count || 0;
  const hasCanonical = !!extractedData?.hasCanonical;
  const hasLang = !!extractedData?.hasLang;
  const hasViewport = !!extractedData?.hasViewport;
  const hsts = !!extractedData?.headers?.hsts;
  const csp = !!extractedData?.headers?.csp;
  if (title.length > 10 && desc.length > 20) seoScore += 20;
  if (h1Count > 0) seoScore += 10;
  if (hasCanonical) seoScore += 10;
  if (hsts) securityScore += 20;
  if (csp) securityScore += 20;
  if (hasLang) a11yScore += 20;
  if (hasViewport) a11yScore += 20;

  // Adjust performance based on whether we got real data
  perfScore = extractedData?.title ? 55 : 40;

  const overallScore = Math.round((perfScore + seoScore + a11yScore + securityScore + designScore) / 5);

  return {
    performanceScore: perfScore, seoScore, accessibilityScore: a11yScore, securityScore, designScore, overallScore,
    overallGrade: getGrade(overallScore), performanceGrade: getGrade(perfScore), seoGrade: getGrade(seoScore), accessibilityGrade: getGrade(a11yScore), securityGrade: getGrade(securityScore),
    recommendations: { downloadReport: true, priority: overallScore < 60 ? 'high' : 'medium', suggestedServices: ['Technical SEO Audit', 'Performance Optimization'], expectedImpact: 'high', estimatedEffort: 'medium' },
    webVitals: { desktop: { lcp: 2500, cls: 0.1, inp: 200, fcp: 1500, ttfb: 500 }, mobile: { lcp: 3000, cls: 0.15, inp: 250, fcp: 2000, ttfb: 600 } },
    seo: { title: { present: !!title, value: title, length: title.length }, metaDescription: { present: !!desc, value: desc, length: desc.length }, h1: { present: h1Count > 0, count: h1Count }, canonical: { present: hasCanonical }, openGraph: { present: !!extractedData?.hasOpenGraph }, structuredData: { present: false, errors: [] }, robotsTxt: { present: true }, sitemap: { present: true }, duplicateTitle: false, duplicateDescription: false, thinContent: false },
    accessibility: { score: a11yScore, violations: [{ id: 'fallback', impact: 'moderate', description: 'Limited accessibility check (fallback mode)' }], langAttribute: hasLang, viewportMeta: hasViewport, altImages: 0, ariaLabels: 0 },
    security: { score: securityScore, hsts: { present: hsts }, csp: { present: csp }, xFrameOptions: { present: !!extractedData?.headers?.xfo }, xContentTypeOptions: { present: !!extractedData?.headers?.xcto }, referrerPolicy: { present: false }, permissionsPolicy: { present: false } },
    links: { totalInternal: extractedData?.internalLinks || 0, totalExternal: extractedData?.externalLinks || 0, brokenInternal: 0, brokenExternal: 0, redirectChains: [], orphanPages: [] },
    design: { overall: designScore, typography: 60, color: 60, spacing: 60, layout: 60, interaction: 60, consistency: 60, polish: 60 },
    screenshotDesktop: '', screenshotMobile: '', pagesCrawled: 1, crawlDuration: 5, timestamp: Date.now(),
    redFlags: overallScore < 70 ? [{ severity: 'high', category: 'system', message: `⚠ Fallback mode: deep audit unavailable`, impact: 'Scores are estimated from page scrape. Try again or check server logs.' }] : [],
    raw: null
  };
}