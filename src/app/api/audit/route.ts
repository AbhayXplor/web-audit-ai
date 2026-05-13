import { NextRequest, NextResponse } from 'next/server';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { chromium } from 'playwright';
import { resolve } from 'path';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Shared progress state keyed by requestId
const auditProgress = new Map<string, { progress: number; stage: string; message: string }>();

export async function POST(req: NextRequest) {
  let browser = null;
  let extractedData: any = {};
  const requestId = Math.random().toString(36).substring(2, 8);

  try {
    const { url, depth = 1, maxPages = 3, requestId: externalId } = await req.json();
    const id = externalId || requestId;
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    console.log(`[AUDIT:${id}] Starting: ${normalizedUrl} (depth:${depth}, maxPages:${maxPages})`);

    setProgress(id, 5, 'Crawling website', 'Running site-audit CLI...');

    // === STEP 1: Run site-audit CLI ===
    let siteAudit: any = null;
    let siteAuditError: string | null = null;

    try {
      const binPath = resolve(process.cwd(), 'node_modules', '@benven', 'site-audit', 'dist', 'cli.js');
      const { stdout } = await execFileAsync(process.execPath, [binPath, 'audit', normalizedUrl, '--json', '--depth', String(depth), '--max-pages', String(maxPages), '--no-robots', '--ci'], {
        timeout: 240000,
        maxBuffer: 50 * 1024 * 1024,
        cwd: process.cwd()
      });
      const jsonStr = extractJson(stdout);
      siteAudit = JSON.parse(jsonStr);
      console.log(`[AUDIT:${id}] CLI succeeded. Pages: ${siteAudit.crawl?.totalPages || 0}`);
    } catch (e1: any) {
      console.log(`[AUDIT:${id}] Direct CLI failed: ${e1.message}. Trying npx...`);
      try {
        const { stdout } = await execAsync(`npx --yes @benven/site-audit audit "${normalizedUrl}" --json --depth ${depth} --max-pages ${maxPages} --no-robots --ci`, {
          timeout: 240000,
          maxBuffer: 50 * 1024 * 1024,
          cwd: process.cwd()
        });
        const jsonStr = extractJson(stdout);
        siteAudit = JSON.parse(jsonStr);
        console.log(`[AUDIT:${id}] npx succeeded. Pages: ${siteAudit.crawl?.totalPages || 0}`);
      } catch (e2: any) {
        let recovered = false;
        if (e2.stdout && typeof e2.stdout === 'string') {
          try {
            const jsonStr = extractJson(e2.stdout);
            if (jsonStr && jsonStr.startsWith('{')) {
              siteAudit = JSON.parse(jsonStr);
              console.log(`[AUDIT:${id}] Recovered JSON from error stdout. Pages: ${siteAudit.crawl?.totalPages || 0}`);
              recovered = true;
            }
          } catch { }
        }
        if (!recovered) {
          siteAuditError = `site-audit failed: ${e1.message}`;
          console.log(`[AUDIT:${id}] Both CLI and npx failed. Will use Playwright fallback.`);
        }
      }
    }

    // === STEP 2: Playwright Deep Analysis + Screenshots ===
    let screenshotDesktop = '', screenshotMobile = '';
    let designMetrics: any = {};
    let mobileChecks: any = {};
    let imageIssues: any[] = [];
    let allLinks: string[] = [];

    setProgress(id, 40, 'Analyzing page', 'Launching browser...');

    try {
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

      setProgress(id, 45, 'Analyzing page', 'Desktop analysis...');
      const dp = await browser.newPage();
      await dp.setViewportSize({ width: 1280, height: 800 });
      const pageResponse = await dp.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Full extracted data including design metrics, images, links
      extractedData = await dp.evaluate(() => {
        const title = document.title;
        const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
        const h1Count = document.querySelectorAll('h1').length;

        // Design metrics
        const bodyStyle = getComputedStyle(document.body);
        const fontSize = parseFloat(bodyStyle.fontSize);
        const lineHeight = bodyStyle.lineHeight !== 'normal' ? parseFloat(bodyStyle.lineHeight) : fontSize * 1.2;
        const primaryColor = bodyStyle.color;
        const bgColor = bodyStyle.backgroundColor;
        const fontFamily = bodyStyle.fontFamily;

        // Check for CSS framework
        const hasTailwind = !!document.querySelector('[class*="flex"], [class*="grid"], [class*="p-"], [class*="m-"]');
        const hasBootstrap = !!document.querySelector('[class*="col-"], [class*="row"], [class*="container"]');
        const cssFramework = hasTailwind ? 'Tailwind CSS' : hasBootstrap ? 'Bootstrap' : 'Unknown/Other';

        // Measure typography consistency
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        const headingSizes = headings.map(h => ({ tag: h.tagName, size: parseFloat(getComputedStyle(h).fontSize) }));
        const headingFonts = [...new Set(headings.map(h => getComputedStyle(h).fontFamily))];
        const consistentHeadings = headingFonts.length <= 2;

        // Color contrast (rough check - check if body text vs background has decent contrast)
        const contrastRatio = estimateContrast(primaryColor, bgColor);

        // Spacing consistency
        const allEls = Array.from(document.querySelectorAll('p, div, section, article'));
        const margins = allEls.map(el => parseFloat(getComputedStyle(el).marginTop)).filter(v => !isNaN(v) && v > 0);
        const avgMargin = margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
        const marginConsistency = margins.length > 0 ?
          margins.filter(m => Math.abs(m - avgMargin) / avgMargin < 0.3).length / margins.length * 100 : 50;

        // Interactive states - check if buttons/links have hover/focus styles
        const interactiveEls = Array.from(document.querySelectorAll('a, button, input, select, textarea'));
        let hasHoverStyles = false, hasFocusStyles = false;
        for (let i = 0; i < Math.min(interactiveEls.length, 20); i++) {
          const el = interactiveEls[i];
          const before = getComputedStyle(el);
          // Check for :hover via different approach - look for CSS rules
        }
        // Check for transition/transform on interactive elements
        const hasTransitions = interactiveEls.some(el => {
          const style = getComputedStyle(el);
          return style.transitionDuration !== '0s' || style.transitionProperty !== 'none';
        });

        // Image analysis
        const images = Array.from(document.querySelectorAll('img'));
        const imgIssues = images.map(img => {
          const hasAlt = img.hasAttribute('alt');
          const altText = img.getAttribute('alt') || '';
          const hasDimensions = img.hasAttribute('width') && img.hasAttribute('height');
          const naturalW = img.naturalWidth || 0;
          const naturalH = img.naturalHeight || 0;
          const displayW = img.clientWidth || 0;
          const isLazy = img.getAttribute('loading') === 'lazy';
          const src = img.getAttribute('src') || '';
          const isWebpAvif = src.match(/\.(webp|avif)(\?|$)/i);
          return {
            src: src.substring(0, 100),
            hasAlt, altText: altText.substring(0, 60),
            hasDimensions, naturalW, naturalH, displayW,
            isLazy, isNextGen: !!isWebpAvif,
            oversized: displayW > 0 && naturalW > displayW * 2
          };
        });

        // Check for interlaced/loading animation placeholder (layout shift indicator)
        const hasPlaceholder = images.some(img => {
          const aspectRatio = img.getAttribute('aspect-ratio') || img.style.aspectRatio;
          return aspectRatio && aspectRatio !== 'auto';
        });

        // Collect all links for broken link checking
        const links = Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.getAttribute('href') || '')
          .filter(h => h.startsWith('http') || h.startsWith('/') || h.startsWith('#') || h.startsWith('?'))
          .slice(0, 100);

        // Animation/transition count
        const animatedEls = allEls.filter(el => {
          const s = getComputedStyle(el);
          return s.animationName !== 'none' || s.transitionDuration !== '0s';
        }).length;

        function estimateContrast(color1: string, color2: string): number {
          const r1 = parseInt(color1.slice(1, 3), 16) || 0;
          const g1 = parseInt(color1.slice(3, 5), 16) || 0;
          const b1 = parseInt(color1.slice(5, 7), 16) || 0;
          const r2 = parseInt(color2.slice(1, 3), 16) || 255;
          const g2 = parseInt(color2.slice(3, 5), 16) || 255;
          const b2 = parseInt(color2.slice(5, 7), 16) || 255;
          const l1 = 0.2126 * (r1 / 255) + 0.7152 * (g1 / 255) + 0.0722 * (b1 / 255);
          const l2 = 0.2126 * (r2 / 255) + 0.7152 * (g2 / 255) + 0.0722 * (b2 / 255);
          const lighter = Math.max(l1, l2);
          const darker = Math.min(l1, l2);
          return (lighter + 0.05) / (darker + 0.05);
        }

        return {
          title, metaDescription, h1Count,
          hasCanonical: !!document.querySelector('link[rel="canonical"]'),
          hasOpenGraph: document.querySelectorAll('meta[property^="og:"]').length > 0,
          hasLang: !!document.documentElement.getAttribute('lang'),
          hasViewport: !!document.querySelector('meta[name="viewport"]'),
          internalLinks: Array.from(document.querySelectorAll('a')).filter(a => a.href && a.href.startsWith(window.location.origin)).length,
          externalLinks: Array.from(document.querySelectorAll('a')).filter(a => a.href && !a.href.startsWith(window.location.origin) && !a.href.startsWith('javascript')).length,
          design: {
            fontSize, lineHeight, fontFamily, primaryColor, bgColor,
            cssFramework, headingSizes, headingFonts, consistentHeadings,
            contrastRatio: Math.round(contrastRatio * 10) / 10,
            avgMargin: Math.round(avgMargin), marginConsistency: Math.round(marginConsistency),
            hasTransitions, animatedEls, interactiveCount: interactiveEls.length
          },
          images: imgIssues,
          hasPlaceholder,
          allLinks: links
        };
      });

      const headers = pageResponse?.headers() || {};
      extractedData.headers = {
        hsts: !!headers['strict-transport-security'],
        csp: !!headers['content-security-policy'],
        xfo: !!headers['x-frame-options'],
        xcto: !!headers['x-content-type-options']
      };

      designMetrics = extractedData.design || {};
      imageIssues = extractedData.images || [];
      allLinks = extractedData.allLinks || [];

      await dp.waitForTimeout(1000);
      screenshotDesktop = (await dp.screenshot({ type: 'jpeg', quality: 50 })).toString('base64');
      await dp.close();

      // Mobile analysis
      setProgress(id, 60, 'Mobile analysis', 'Checking mobile view...');
      const mp = await browser.newPage();
      await mp.setViewportSize({ width: 375, height: 667 });
      await mp.goto(normalizedUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await mp.waitForTimeout(1000);

      mobileChecks = await mp.evaluate(() => {
        const viewportMeta = document.querySelector('meta[name="viewport"]');
        const viewportContent = viewportMeta?.getAttribute('content') || '';

        // Check for horizontal overflow
        const docWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const viewportWidth = window.innerWidth;
        const hasOverflow = docWidth > viewportWidth + 5;

        // Tap target sizes (check all clickable elements)
        const clickables = Array.from(document.querySelectorAll('a, button, [onclick], input[type="submit"]'));
        const smallTargets = clickables.filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (rect.width < 48 || rect.height < 48);
        }).length;

        // Check font sizes on mobile
        const bodyFontSize = parseFloat(getComputedStyle(document.body).fontSize);
        const smallFonts = Array.from(document.querySelectorAll('p, li, span, div:not([class*="header"]):not([class*="nav"])'))
          .filter(el => {
            const fs = parseFloat(getComputedStyle(el).fontSize);
            return fs > 0 && fs < 12;
          }).length;

        // Check for clickable elements too close together
        const positions = clickables.map(el => el.getBoundingClientRect()).filter(r => r.width > 0);
        let spacingIssues = 0;
        for (let i = 0; i < Math.min(positions.length, 30); i++) {
          for (let j = i + 1; j < Math.min(positions.length, 30); j++) {
            const a = positions[i], b = positions[j];
            const vertDist = Math.abs(a.top - b.top);
            const horzDist = Math.abs(a.left - b.left);
            if (vertDist < 32 && vertDist > 0 && (horzDist < 48 && a.right > b.left)) spacingIssues++;
          }
        }

        return {
          viewportContent,
          hasOverflow,
          docWidth, viewportWidth,
          smallTargets,
          bodyFontSize,
          smallFonts,
          tapSpacingIssues: Math.min(spacingIssues, 20)
        };
      });

      screenshotMobile = (await mp.screenshot({ type: 'jpeg', quality: 50 })).toString('base64');
      await mp.close();
    } catch (e) {
      console.error(`[AUDIT:${id}] Browser analysis error:`, e);
    } finally {
      if (browser) try { await browser.close(); } catch { }
    }

    // === STEP 2B: Independent Broken Link Checking ===
    const linkResults = { total: 0, broken: 0, checked: 0, errors: [] as any[] };
    if (allLinks.length > 0) {
      setProgress(id, 70, 'Checking links', `Testing ${allLinks.length} links...`);
      // Resolve relative URLs and deduplicate
      const resolvedLinks = [...new Set(allLinks.map((l: string) => {
        if (l.startsWith('http')) return l;
        if (l.startsWith('/')) return new URL(l, normalizedUrl).href;
        if (l.startsWith('#') || l.startsWith('?')) return null;
        return new URL(l, normalizedUrl).href;
      }).filter(Boolean))] as string[];

      linkResults.total = resolvedLinks.length;
      // Check up to 50 links
      const toCheck = resolvedLinks.slice(0, 50);
      for (const link of toCheck) {
        try {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 5000);
          const res = await fetch(link, { method: 'HEAD', signal: ctrl.signal, redirect: 'manual' });
          clearTimeout(to);
          linkResults.checked++;
          if (res.status >= 400 || res.status === 0) {
            linkResults.broken++;
            linkResults.errors.push({ url: link.substring(0, 80), status: res.status });
          }
        } catch {
          linkResults.checked++;
          linkResults.broken++;
          linkResults.errors.push({ url: link.substring(0, 80), status: 0 });
        }
        if (linkResults.errors.length >= 20) break; // Stop early if too many errors
      }
      console.log(`[AUDIT:${id}] Link check: ${linkResults.broken} broken of ${linkResults.checked} checked`);
    }

    // === STEP 3: PSI API ===
    setProgress(id, 80, 'Performance check', 'Fetching PageSpeed data...');
    let psiData: any = null;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(normalizedUrl)}&strategy=mobile`, { signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) psiData = await r.json();
    } catch { }

    // === STEP 4: Compute design scores from real metrics ===
    const designScores = computeDesignScores(designMetrics, mobileChecks, imageIssues);

    // === STEP 5: Build audit ===
    setProgress(id, 90, 'Building report', 'Calculating scores...');
    let audit: any;
    if (siteAuditError || !siteAudit) {
      audit = createFallbackAudit(normalizedUrl, extractedData);
      // Override design with real metrics even in fallback
      audit.design = designScores.breakdown;
      audit.designScore = designScores.overall;
    } else {
      audit = buildAudit(siteAudit, {
        screenshotDesktop, screenshotMobile, psiData,
        designScores, mobileChecks, imageIssues, linkResults
      });
    }

    // Attach screenshots
    if (screenshotDesktop) audit.screenshotDesktop = screenshotDesktop;
    if (screenshotMobile) audit.screenshotMobile = screenshotMobile;

    // Add real audit metadata
    audit._designMetrics = designMetrics;
    audit._mobileChecks = mobileChecks;
    audit._linkCheck = linkResults;

    setProgress(id, 100, 'Complete', 'Audit finished');
    console.log(`[AUDIT:${id}] Complete. Overall: ${audit.overallScore}`);

    return NextResponse.json({ audit });
  } catch (error: any) {
    console.error(`[AUDIT:${requestId}] Fatal error:`, error);
    return NextResponse.json({
      error: error.message,
      details: error.stack,
      audit: createFallbackAudit('unknown', extractedData || {})
    }, { status: 500 });
  }
}

// Progress tracking helpers
function setProgress(id: string, progress: number, stage: string, message: string) {
  auditProgress.set(id, { progress, stage, message });
}

function getProgress(id: string) {
  return auditProgress.get(id) || { progress: 0, stage: 'Waiting', message: 'Queued...' };
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  return NextResponse.json(getProgress(id));
}

// ====== Design Score Computation ======
function computeDesignScores(design: any, mobile: any, images: any[]) {
  let typography = 70, color = 65, spacing = 65, layout = 70, interaction = 60, consistency = 70, polish = 55;

  // Typography
  if (design.fontSize) {
    if (design.fontSize >= 16) typography += 15;
    else if (design.fontSize >= 14) typography += 5;
    else typography -= 10;
  }
  if (design.lineHeight && design.fontSize) {
    const ratio = design.lineHeight / design.fontSize;
    if (ratio >= 1.5 && ratio <= 1.8) typography += 10;
    else if (ratio >= 1.3) typography += 5;
    else typography -= 5;
  }
  if (design.consistentHeadings) typography += 10;
  if (mobile && mobile.bodyFontSize < 14) typography -= 15;
  if (mobile && mobile.smallFonts > 5) typography -= 10;

  // Color & Contrast
  if (design.contrastRatio) {
    if (design.contrastRatio >= 7) color += 20;
    else if (design.contrastRatio >= 4.5) color += 10;
    else color -= 10;
  }
  if (design.cssFramework === 'Tailwind CSS') color += 5;

  // Spacing
  if (design.marginConsistency) {
    if (design.marginConsistency >= 70) spacing += 15;
    else if (design.marginConsistency >= 50) spacing += 5;
    else spacing -= 10;
  }
  if (design.avgMargin && design.avgMargin >= 16 && design.avgMargin <= 32) spacing += 10;

  // Layout
  if (mobile) {
    if (!mobile.hasOverflow) layout += 15;
    else layout -= 15;
  }
  if (design.cssFramework && design.cssFramework !== 'Unknown/Other') layout += 10;

  // Interaction
  if (design.hasTransitions) interaction += 15;
  if (design.animatedEls && design.animatedEls > 0) interaction += 10;
  if (mobile) {
    if (mobile.smallTargets === 0) interaction += 15;
    else if (mobile.smallTargets <= 3) interaction += 5;
    else interaction -= 10;
    if (mobile.tapSpacingIssues === 0) interaction += 10;
    else if (mobile.tapSpacingIssues <= 5) interaction += 5;
    else interaction -= 5;
  }

  // Consistency
  if (design.consistentHeadings) consistency += 10;
  if (design.cssFramework && design.cssFramework !== 'Unknown/Other') consistency += 10;
  if (design.fontFamily && !design.fontFamily.includes(',') && !design.fontFamily.includes('serif')) consistency += 5;

  // Polish (image optimization, transitions, animations)
  if (images && images.length > 0) {
    const withAlt = images.filter((i: any) => i.hasAlt).length;
    const altPct = withAlt / images.length;
    if (altPct >= 0.9) polish += 15;
    else if (altPct >= 0.7) polish += 5;
    else polish -= 10;

    const nextGen = images.filter((i: any) => i.isNextGen).length;
    if (nextGen / images.length >= 0.5) polish += 10;

    const oversized = images.filter((i: any) => i.oversized).length;
    if (oversized > 3) polish -= 10;
  }
  if (design.hasTransitions) polish += 5;
  if (mobile && mobile.viewportContent.includes('width=device-width')) polish += 5;

  // Clamp all scores to 0-100
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const scores = {
    typography: clamp(typography),
    color: clamp(color),
    spacing: clamp(spacing),
    layout: clamp(layout),
    interaction: clamp(interaction),
    consistency: clamp(consistency),
    polish: clamp(polish)
  };
  const overall = clamp(Math.round(
    (scores.typography + scores.color + scores.spacing + scores.layout + scores.interaction + scores.consistency + scores.polish) / 7
  ));

  return { overall, breakdown: { ...scores, overall } };
}

// ====== Existing Functions ======
function buildAudit(siteAudit: any, opts: {
  screenshotDesktop: string; screenshotMobile: string; psiData: any;
  designScores?: any; mobileChecks?: any; imageIssues?: any[]; linkResults?: any;
}): any {
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

  // --- REAL DESIGN SCORES ---
  let designScore = 65;
  let designBreakdown = { overall: 65, typography: 70, color: 60, spacing: 65, layout: 70, interaction: 60, consistency: 75, polish: 55 };
  if (opts.designScores) {
    designScore = opts.designScores.overall;
    designBreakdown = opts.designScores.breakdown;
  }

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

  // Use real link data if available
  const finalBrokenInternal = opts.linkResults?.broken ?? brokenInternal;
  const finalTotalInternal = opts.linkResults?.total ?? totalInternal;
  if (finalBrokenInternal > 20) redFlags.unshift({ severity: 'critical', category: 'links', message: `${finalBrokenInternal} broken links found`, impact: 'Lost SEO equity, degraded UX' });
  else if (finalBrokenInternal > 5) redFlags.push({ severity: 'high', category: 'links', message: `${finalBrokenInternal} broken links — needs repair`, impact: 'Users hitting dead pages' });

  if (!hasHsts) redFlags.unshift({ severity: 'critical', category: 'security', message: 'Missing HSTS header', impact: 'Security risk, SEO downgrade' });
  if (robotsTxtDisallowAll) redFlags.unshift({ severity: 'critical', category: 'seo', message: 'robots.txt blocks all crawlers', impact: 'Zero search visibility' });
  if (lcp > 2500) redFlags.push({ severity: 'high', category: 'performance', message: `LCP ${(lcp / 1000).toFixed(1)}s — should be <2.5s`, impact: '18% higher bounce per 1s' });
  if (inp > 200) redFlags.push({ severity: 'high', category: 'performance', message: `INP ${inp}ms — poor interactivity`, impact: 'User frustration' });
  if (!hasOpenGraph) redFlags.push({ severity: 'high', category: 'seo', message: 'Missing Open Graph tags', impact: 'Poor social sharing' });
  if (!structuredDataPresent) redFlags.push({ severity: 'high', category: 'seo', message: 'No structured data', impact: 'No rich snippets' });
  if (duplicateTitle) redFlags.push({ severity: 'high', category: 'seo', message: 'Duplicate page titles', impact: 'Keyword cannibalization' });
  if (a11yScore < 70) redFlags.push({ severity: 'high', category: 'accessibility', message: `Accessibility score ${a11yScore}/100`, impact: 'ADA compliance risk' });

  // Mobile-specific red flags
  if (opts.mobileChecks?.smallTargets && opts.mobileChecks.smallTargets > 5) {
    redFlags.push({ severity: 'high', category: 'accessibility', message: `${opts.mobileChecks.smallTargets} touch targets too small (<48px)`, impact: 'Poor mobile UX, users miss taps' });
  }
  if (opts.mobileChecks?.hasOverflow) {
    redFlags.push({ severity: 'high', category: 'design', message: 'Horizontal overflow on mobile — content wider than viewport', impact: 'Users must scroll sideways, high bounce' });
  }
  if (opts.mobileChecks?.tapSpacingIssues && opts.mobileChecks.tapSpacingIssues > 5) {
    redFlags.push({ severity: 'medium', category: 'design', message: `${opts.mobileChecks.tapSpacingIssues} tap targets too close together`, impact: 'Accidental taps, frustrated users' });
  }

  // Image red flags
  if (opts.imageIssues) {
    const withoutAlt = opts.imageIssues.filter((i: any) => !i.hasAlt).length;
    if (withoutAlt > 3) redFlags.push({ severity: 'high', category: 'seo', message: `${withoutAlt} images missing alt text`, impact: 'Lost SEO, accessibility violations' });
    const oversized = opts.imageIssues.filter((i: any) => i.oversized).length;
    if (oversized > 3) redFlags.push({ severity: 'medium', category: 'performance', message: `${oversized} images displayed smaller than actual size`, impact: 'Wasted bandwidth, slow load' });
  }

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
    recommendations: getRecommendations({ overallScore, redFlags: uniqueFlags, links: { brokenInternal: finalBrokenInternal }, webVitals: { mobile: { lcp, cls, inp } }, security: { hsts: { present: hasHsts } } }),
    webVitals: { desktop: { lcp, cls, inp, fcp, ttfb }, mobile: { lcp, cls, inp, fcp, ttfb } },
    seo: { title: { present: !!firstPage.title, length: firstPage.title?.length || 0, value: firstPage.title || null }, metaDescription: { present: !!firstPage.metaDescription, length: firstPage.metaDescription?.length || 0, value: firstPage.metaDescription || null }, h1: { present: totalH1 > 0, count: totalH1 }, canonical: { present: hasCanonical, value: firstPage.canonicalUrl || null }, openGraph: { present: hasOpenGraph }, structuredData: { present: structuredDataPresent, type: 'unknown', errors: [] }, robotsTxt: { present: !robotsTxtMissing, content: null }, sitemap: { present: !sitemapMissing, url: null }, duplicateTitle, duplicateDescription: duplicateDesc, thinContent },
    accessibility: { score: a11yScore, violations: a11yIssues.map((i: any) => ({ id: i.rule, impact: mapImpact(i.severity), description: i.message })), langAttribute: !langMissing, viewportMeta: !viewportMissing, altImages: opts.imageIssues?.filter((i: any) => i.hasAlt).length || 0, ariaLabels: 0 },
    security: { score: securityScore, hsts: { present: hasHsts, maxAge: 0 }, csp: { present: hasCsp, value: '' }, xFrameOptions: { present: hasXfo, value: '' }, xContentTypeOptions: { present: hasXcto }, referrerPolicy: { present: false, value: '' }, permissionsPolicy: { present: false, value: '' } },
    links: { totalInternal: finalTotalInternal, totalExternal, brokenInternal: finalBrokenInternal, brokenExternal, redirectChains, orphanPages, linkCheckTotal: opts.linkResults?.total || 0, linkCheckBroken: opts.linkResults?.broken || 0 },
    design: designBreakdown,
    screenshotDesktop: opts.screenshotDesktop || undefined,
    screenshotMobile: opts.screenshotMobile || undefined,
    pagesCrawled: siteAudit.crawl?.totalPages ?? (pages.length || 1),
    crawlDuration: siteAudit.crawl?.elapsedMs ? Math.round(siteAudit.crawl.elapsedMs / 1000) : 0,
    timestamp: now,
    redFlags: uniqueFlags.slice(0, 12),
    imageIssues: opts.imageIssues?.slice(0, 20),
    mobileChecks: opts.mobileChecks
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
    design: extractedData?.design ? { overall: 60, typography: 60, color: 60, spacing: 60, layout: 60, interaction: 60, consistency: 60, polish: 60 } : { overall: 60, typography: 60, color: 60, spacing: 60, layout: 60, interaction: 60, consistency: 60, polish: 60 },
    screenshotDesktop: '', screenshotMobile: '', pagesCrawled: 1, crawlDuration: 5, timestamp: Date.now(),
    redFlags: overallScore < 70 ? [{ severity: 'high', category: 'system', message: '⚠ Fallback mode: deep audit unavailable', impact: 'Scores are estimated from page scrape. Try again or check server logs.' }] : [],
    raw: null
  };
}