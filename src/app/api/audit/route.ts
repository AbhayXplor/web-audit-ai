import { NextRequest, NextResponse } from 'next/server';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { chromium, Browser } from 'playwright';
import { resolve } from 'path';
import { AuditMode } from '@/types';
import { AUDIT_MODES } from '@/lib/audit-modes';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const auditProgress = new Map<string, { progress: number; stage: string; message: string }>();

export async function POST(req: NextRequest) {
  let browser: Browser | null = null;
  let extractedData: any = {};
  const requestId = Math.random().toString(36).substring(2, 8);

  try {
    const { url, mode = 'balanced', requestId: externalId } = await req.json();
    const config = AUDIT_MODES[mode as AuditMode] || AUDIT_MODES.balanced;
    const id = externalId || requestId;
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    console.log(`[AUDIT:${id}] Starting: ${normalizedUrl} (mode:${mode})`);
    setProgress(id, 5, 'Crawling website', `Running site-audit CLI with ${mode} settings...`);

    // === STEP 1: Run site-audit CLI ===
    let siteAudit: any = null;
    let siteAuditError: string | null = null;

    if (mode !== 'fast') {
      try {
        const binPath = resolve(process.cwd(), 'node_modules', '@benven', 'site-audit', 'dist', 'cli.js');
        const { stdout } = await execFileAsync(process.execPath, [binPath, 'audit', normalizedUrl, '--json', '--depth', String(config.depth), '--max-pages', String(config.maxPages), '--no-robots', '--ci'], { timeout: 240000, maxBuffer: 50 * 1024 * 1024, cwd: process.cwd() });
        siteAudit = JSON.parse(extractJson(stdout));
      } catch (e1: any) {
        console.log(`[AUDIT:${id}] Direct CLI failed: ${e1.message.substring(0, 100)}. Trying npx...`);
        try {
          const { stdout } = await execAsync(`npx --yes @benven/site-audit audit "${normalizedUrl}" --json --depth ${String(config.depth)} --max-pages ${String(config.maxPages)} --no-robots --ci`, { timeout: 600000, maxBuffer: 50 * 1024 * 1024, cwd: process.cwd() });
          siteAudit = JSON.parse(extractJson(stdout));
          console.log(`[AUDIT:${id}] npx succeeded. Pages: ${siteAudit.crawl?.totalPages || 0}`);
        } catch (e2: any) {
          let recovered = false;
          if (e2.stdout && typeof e2.stdout === 'string') {
            try {
              const jsonStr = extractJson(e2.stdout);
              if (jsonStr && jsonStr.startsWith('{')) { siteAudit = JSON.parse(jsonStr); recovered = true; }
            } catch { }
          }
          if (!recovered) { siteAuditError = `site-audit failed: ${e1.message}`; }
        }
      }
    }

    // === STEP 2: Playwright Deep Analysis + Screenshots ===
    let screenshotDesktop = '', screenshotMobile = '';
    let designMetrics: any = {};
    let mobileChecks: any = {};
    let imageIssues: any[] = [];
    let allLinks: string[] = [];
    let conversionData: any = {};

    setProgress(id, 40, 'Analyzing page', 'Launching browser...');

    try {
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });

      // --- Desktop analysis ---
      setProgress(id, 45, 'Analyzing page', `Loading desktop view (${config.loadWaitUntil} + ${config.screenshotWait}s settle)...`);
      const dp = await browser.newPage();
      await dp.setViewportSize({ width: 1280, height: 800 });
      const pageResponse = await dp.goto(normalizedUrl, { waitUntil: config.loadWaitUntil, timeout: 45000 });
      await dp.waitForTimeout(config.screenshotWait * 1000);

      extractedData = await dp.evaluate(() => {
        const title = document.title;
        const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
        const h1Count = document.querySelectorAll('h1').length;
        const bodyStyle = getComputedStyle(document.body);
        const fontSize = parseFloat(bodyStyle.fontSize);
        const lineHeight = bodyStyle.lineHeight !== 'normal' ? parseFloat(bodyStyle.lineHeight) : fontSize * 1.2;
        const primaryColor = bodyStyle.color;
        const bgColor = bodyStyle.backgroundColor;
        const fontFamily = bodyStyle.fontFamily;
        const hasTailwind = !!document.querySelector('[class*="flex"],[class*="grid"],[class*="p-"],[class*="m-"]');
        const hasBootstrap = !!document.querySelector('[class*="col-"],[class*="row"],[class*="container"]');
        const cssFramework = hasTailwind ? 'Tailwind CSS' : hasBootstrap ? 'Bootstrap' : 'Unknown/Other';
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
        const headingFonts = [...new Set(headings.map(h => getComputedStyle(h).fontFamily))];
        const consistentHeadings = headingFonts.length <= 2;
        const allEls = Array.from(document.querySelectorAll('p,div,section,article'));
        const margins = allEls.map(el => parseFloat(getComputedStyle(el).marginTop)).filter(v => !isNaN(v) && v > 0);
        const avgMargin = margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
        const marginConsistency = margins.length > 0 ? margins.filter(m => Math.abs(m - avgMargin) / avgMargin < 0.3).length / margins.length * 100 : 50;
        const interactiveEls = Array.from(document.querySelectorAll('a,button,input,select,textarea'));
        const hasTransitions = interactiveEls.some(el => { const s = getComputedStyle(el); return s.transitionDuration !== '0s' || s.transitionProperty !== 'none'; });
        const animatedEls = allEls.filter(el => { const s = getComputedStyle(el); return s.animationName !== 'none' || s.transitionDuration !== '0s'; }).length;
        const images = Array.from(document.querySelectorAll('img'));
        const imgIssues = images.map(img => ({
          src: (img.getAttribute('src') || '').substring(0, 100),
          hasAlt: img.hasAttribute('alt'),
          altText: (img.getAttribute('alt') || '').substring(0, 60),
          hasDimensions: img.hasAttribute('width') && img.hasAttribute('height'),
          naturalW: img.naturalWidth || 0,
          displayW: img.clientWidth || 0,
          isLazy: img.getAttribute('loading') === 'lazy',
          isNextGen: !!(img.getAttribute('src') || '').match(/\.(webp|avif)(\?|$)/i),
          oversized: (img.clientWidth || 0) > 0 && (img.naturalWidth || 0) > (img.clientWidth || 0) * 2
        }));
        // Collect links (limit to 100), ignoring javascript/mailto/tel
        const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href') || '').filter(h => h && !h.startsWith('javascript:') && !h.startsWith('mailto:') && !h.startsWith('tel:')).slice(0, 100);
        const pageText = document.body.innerText.toLowerCase();
        const htmlContent = document.documentElement.outerHTML.toLowerCase();

        // Structural / Conversion Analysis
        const ctaKeywords = ['get started', 'contact us', 'book now', 'schedule', 'free quote', 'buy now', 'shop now', 'sign up', 'subscribe', 'request', 'learn more', 'get a quote', 'free consultation', 'get in touch'];
        const linkTexts = Array.from(document.querySelectorAll('a,button,input[type="submit"],[role="button"]')).map(el => (el.textContent || '').trim().toLowerCase());
        const ctaCount = linkTexts.filter(t => ctaKeywords.some(k => t.includes(k))).length;
        const trustKeywords = ['testimonial', 'review', 'trusted by', 'as seen on', 'certified', 'award winning', 'client', 'case study', 'satisfied customer', 'recommended', 'guarantee', 'money back', 'partners'];
        const trustSignalCount = trustKeywords.filter(k => pageText.includes(k)).length;
        const socialPlatforms = ['instagram.com', 'facebook.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com', 'pinterest.com'];
        const socialLinks = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href') || '').filter(h => socialPlatforms.some(p => h.includes(p)));
        const hasPhone = /[\+\d]{7,}/.test(pageText);
        const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(pageText);
        const formCount = document.querySelectorAll('form').length;
        const inputCount = document.querySelectorAll('input:not([type="hidden"]),textarea,select').length;
        const hasPricing = /(\$|£|€|pricing|plans?|packages?|starting at)/i.test(pageText);
        const footer = document.querySelector('footer');
        const footerText = footer?.innerText?.toLowerCase() || '';
        const hasCopyright = footerText.includes('©') || footerText.includes('copyright');
        const hasPrivacyPolicy = footerText.includes('privacy') || footerText.includes('privacy policy');
        const stockKeywords = ['shutterstock', 'istock', 'gettyimages', 'unsplash', 'pexels'];
        const hasStockPhotos = Array.from(document.querySelectorAll('img[src]')).map(i => i.getAttribute('src') || '').some(s => stockKeywords.some(k => s.toLowerCase().includes(k)));
        const hasFavicon = !!document.querySelector('link[rel*="icon"]');
        const isWordPress = htmlContent.includes('wp-content') || htmlContent.includes('wp-json') || htmlContent.includes('wordpress');
        const isShopify = htmlContent.includes('shopify') || htmlContent.includes('myshopify');
        const isWix = htmlContent.includes('wix') || htmlContent.includes('wixstatic');
        const isWebflow = htmlContent.includes('webflow') || htmlContent.includes('data-wf-');
        const detectedCMS = isWordPress ? 'WordPress' : isShopify ? 'Shopify' : isWix ? 'Wix' : isWebflow ? 'Webflow' : 'Unknown/Other';
        const hasGA = htmlContent.includes('google-analytics') || htmlContent.includes('gtag(') || htmlContent.includes('ga(');
        const hasGTM = htmlContent.includes('googletagmanager');
        const hasFB = htmlContent.includes('facebook.com/tr') || htmlContent.includes('fbq(');
        const hasCookieBanner = htmlContent.includes('cookie') && (htmlContent.includes('accept') || htmlContent.includes('consent') || htmlContent.includes('gdpr'));
        const hasPlaceholderText = pageText.includes('lorem ipsum') || pageText.includes('coming soon') || pageText.includes('under construction');
        const visibleText = document.body.innerText?.substring(0, 3000)?.trim();

        function estimateContrast(c1: string, c2: string): number {
          const r1 = parseInt(c1.slice(1, 3), 16) || 0, g1 = parseInt(c1.slice(3, 5), 16) || 0, b1 = parseInt(c1.slice(5, 7), 16) || 0;
          const r2 = parseInt(c2.slice(1, 3), 16) || 255, g2 = parseInt(c2.slice(3, 5), 16) || 255, b2 = parseInt(c2.slice(5, 7), 16) || 255;
          const l1 = 0.2126 * (r1 / 255) + 0.7152 * (g1 / 255) + 0.0722 * (b1 / 255), l2 = 0.2126 * (r2 / 255) + 0.7152 * (g2 / 255) + 0.0722 * (b2 / 255);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        }

        return {
          title, metaDescription, h1Count,
          hasCanonical: !!document.querySelector('link[rel="canonical"]'),
          hasOpenGraph: document.querySelectorAll('meta[property^="og:"]').length > 0,
          hasLang: !!document.documentElement.getAttribute('lang'),
          hasViewport: !!document.querySelector('meta[name="viewport"]'),
          internalLinks: Array.from(document.querySelectorAll('a')).filter(a => a.href && a.href.startsWith(window.location.origin)).length,
          externalLinks: Array.from(document.querySelectorAll('a')).filter(a => a.href && !a.href.startsWith(window.location.origin) && !a.href.startsWith('javascript')).length,
          design: { fontSize, lineHeight, fontFamily, primaryColor, bgColor, cssFramework, headingFonts: [...headingFonts], consistentHeadings, contrastRatio: Math.round(estimateContrast(primaryColor, bgColor) * 10) / 10, avgMargin: Math.round(avgMargin), marginConsistency: Math.round(marginConsistency), hasTransitions, animatedEls, interactiveCount: interactiveEls.length },
          images: imgIssues,
          allLinks: links,
          conversion: { ctaCount, trustSignalCount, socialLinks: socialLinks.length, hasPhone, hasEmail, hasContactForm: formCount > 0 || inputCount > 0, formCount, inputCount, hasPricing, hasCopyright, hasPrivacyPolicy, hasStockPhotos, hasFavicon, detectedCMS, analyticsCount: [hasGA, hasGTM, hasFB].filter(Boolean).length, hasCookieBanner, hasPlaceholderText },
          visibleText
        };
      });

      const headers = pageResponse?.headers() || {};
      extractedData.headers = { hsts: !!headers['strict-transport-security'], csp: !!headers['content-security-policy'], xfo: !!headers['x-frame-options'], xcto: !!headers['x-content-type-options'] };

      designMetrics = extractedData.design || {};
      imageIssues = extractedData.images || [];
      allLinks = extractedData.allLinks || [];
      conversionData = extractedData.conversion || {};

      // --- Desktop screenshot (individual try/catch) ---
      try {
        const shot = await dp.screenshot({ type: 'jpeg', quality: 50, fullPage: true });
        screenshotDesktop = shot.toString('base64');
      } catch (e) {
        console.warn(`[AUDIT:${id}] Desktop screenshot failed:`, e);
      }
      await dp.close();

      // --- Mobile analysis ---
      setProgress(id, 60, 'Mobile analysis', `Checking mobile view (${config.loadWaitUntil} + ${config.screenshotWait}s settle)...`);
      const mp = await browser.newPage();
      await mp.setViewportSize({ width: 375, height: 667 });
      await mp.goto(normalizedUrl, { waitUntil: config.loadWaitUntil, timeout: 45000 });
      await mp.waitForTimeout(config.screenshotWait * 1000);

      mobileChecks = await mp.evaluate(() => {
        const viewportContent = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
        const docWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const vw = window.innerWidth;
        const hasOverflow = docWidth > vw + 5;
        const clickables = Array.from(document.querySelectorAll('a,button,[onclick],input[type="submit"]'));
        const smallTargets = clickables.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 48 || r.height < 48); }).length;
        const bodyFontSize = parseFloat(getComputedStyle(document.body).fontSize);
        const smallFonts = Array.from(document.querySelectorAll('p,li,span,div:not([class*="header"]):not([class*="nav"])')).filter(el => { const fs = parseFloat(getComputedStyle(el).fontSize); return fs > 0 && fs < 12; }).length;
        const positions = clickables.map(el => el.getBoundingClientRect()).filter(r => r.width > 0);
        let spacingIssues = 0;
        for (let i = 0; i < Math.min(positions.length, 30); i++) {
          for (let j = i + 1; j < Math.min(positions.length, 30); j++) {
            const a = positions[i], b = positions[j];
            if (Math.abs(a.top - b.top) < 32 && Math.abs(a.top - b.top) > 0 && (Math.abs(a.left - b.left) < 48 && a.right > b.left)) spacingIssues++;
          }
        }
        return { viewportContent, hasOverflow, docWidth: Math.round(docWidth), smallTargets, bodyFontSize, smallFonts, tapSpacingIssues: Math.min(spacingIssues, 20) };
      });

      // Mobile screenshot
      try {
        const shotM = await mp.screenshot({ type: 'jpeg', quality: 50, fullPage: true });
        screenshotMobile = shotM.toString('base64');
      } catch (eM) {
        console.warn(`[AUDIT:${id}] Mobile screenshot failed:`, eM);
      }
      await mp.close();

    } catch (e) {
      console.error(`[AUDIT:${id}] Browser analysis error:`, e);
    } finally {
      if (browser) { try { await browser.close(); } catch { browser = null; } }
    }

    // === STEP 2B: Broken Link Checking ===
    // Normalize links: strip trailing slashes, lowercase host, remove duplicates
    const normalizeLink = (l: string): string => {
      try {
        const u = new URL(l);
        u.pathname = u.pathname.replace(/\/+$/, '') || '/';
        u.hostname = u.hostname.toLowerCase();
        return u.toString();
      } catch {
        return l.toLowerCase().replace(/\/+$/, '');
      }
    };

    const linkResults = { total: 0, broken: 0, checked: 0, errors: [] as any[] };
    if (allLinks.length > 0) {
      setProgress(id, 70, 'Checking links', `Testing links with ${config.brokenLinksMax} max...`);
      const uniqueLinks = [...new Set(allLinks
        .filter(l => l.startsWith('http'))
        .map(l => normalizeLink(l))
      )];
      linkResults.total = uniqueLinks.length;
      const toCheck = uniqueLinks.slice(0, config.brokenLinksMax);
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
        if (linkResults.errors.length >= config.brokenLinksMax) break;
      }
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

    // === STEP 4: Compute scores ===
    const designScores = computeDesignScores(designMetrics, mobileChecks, imageIssues);
    const conversionScore = computeConversionScore(conversionData);

    // === STEP 5: Build audit ===
    setProgress(id, 90, 'Building report', 'Calculating scores...');
    let audit: any;
    if (siteAuditError || !siteAudit) {
      audit = createFallbackAudit(normalizedUrl, extractedData);
      audit.design = designScores.breakdown;
      audit.designScore = designScores.overall;
    } else {
      audit = buildAudit(siteAudit, {
        screenshotDesktop, screenshotMobile, psiData,
        designScores, mobileChecks, imageIssues, linkResults, conversionData, conversionScore
      });
    }

    if (screenshotDesktop) audit.screenshotDesktop = screenshotDesktop;
    if (screenshotMobile) audit.screenshotMobile = screenshotMobile;
    audit._conversion = conversionData;
    audit._designMetrics = designMetrics;
    audit._mobileChecks = mobileChecks;
    audit._linkCheck = linkResults;
    audit._auditMode = mode;

    setProgress(id, 100, 'Complete', 'Audit finished');
    return NextResponse.json({ audit });
  } catch (error: any) {
    console.error(`[AUDIT:${requestId}] Fatal error:`, error);
    return NextResponse.json({ error: error.message, details: error.stack, audit: createFallbackAudit('unknown', extractedData || {}) }, { status: 500 });
  }
}

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

// ====== Conversion Score ======
function computeConversionScore(conv: any): { overall: number; breakdown: any } {
  let cta = 0, trust = 0, contact = 0, pricing = 0, social = 0, footer = 0, cms = 10, analytics = 0;
  if (conv.ctaCount >= 3) cta = 20; else if (conv.ctaCount >= 1) cta = 10; else cta = 0;
  if (conv.trustSignalCount >= 5) trust = 15; else if (conv.trustSignalCount >= 3) trust = 10; else if (conv.trustSignalCount >= 1) trust = 5; else trust = 0;
  if (conv.hasPhone || conv.hasEmail || conv.hasContactForm) contact = 10; else contact = 0;
  if (conv.hasPricing) pricing = 10; else pricing = 0;
  if (conv.socialLinks >= 3) social = 10; else if (conv.socialLinks >= 1) social = 5; else social = 0;
  if (conv.hasCopyright && conv.hasPrivacyPolicy) footer = 10; else if (conv.hasCopyright || conv.hasPrivacyPolicy) footer = 5; else footer = 0;
  if (conv.detectedCMS !== 'Unknown/Other') cms = 15; else cms = 5;
  if (conv.analyticsCount >= 2) analytics = 10; else if (conv.analyticsCount >= 1) analytics = 5; else analytics = 0;
  const penalties = (conv.hasPlaceholderText ? -10 : 0) + (!conv.hasFavicon ? -5 : 0) + (conv.hasStockPhotos ? -5 : 0);
  const overall = Math.max(0, Math.min(100, cta + trust + contact + pricing + social + footer + cms + analytics + penalties));
  return { overall, breakdown: { cta, trust, contact, pricing, social, footer, cms, analytics } };
}

// ====== Design Score Computation ======
function computeDesignScores(design: any, mobile: any, images: any[]) {
  let typography = 70, color = 65, spacing = 65, layout = 70, interaction = 60, consistency = 70, polish = 55;
  if (design.fontSize) { if (design.fontSize >= 16) typography += 15; else if (design.fontSize >= 14) typography += 5; else typography -= 10; }
  if (design.lineHeight && design.fontSize) { const r = design.lineHeight / design.fontSize; if (r >= 1.5 && r <= 1.8) typography += 10; else if (r >= 1.3) typography += 5; else typography -= 5; }
  if (design.consistentHeadings) typography += 10;
  if (mobile?.bodyFontSize < 14) typography -= 15;
  if (mobile?.smallFonts > 5) typography -= 10;
  if (design.contrastRatio) { if (design.contrastRatio >= 7) color += 20; else if (design.contrastRatio >= 4.5) color += 10; else color -= 10; }
  if (design.cssFramework === 'Tailwind CSS') color += 5;
  if (design.marginConsistency) { if (design.marginConsistency >= 70) spacing += 15; else if (design.marginConsistency >= 50) spacing += 5; else spacing -= 10; }
  if (design.avgMargin && design.avgMargin >= 16 && design.avgMargin <= 32) spacing += 10;
  if (mobile) { if (!mobile.hasOverflow) layout += 15; else layout -= 15; }
  if (design.cssFramework && design.cssFramework !== 'Unknown/Other') layout += 10;
  if (design.hasTransitions) interaction += 15;
  if (design.animatedEls > 0) interaction += 10;
  if (mobile) { if (mobile.smallTargets === 0) interaction += 15; else if (mobile.smallTargets <= 3) interaction += 5; else interaction -= 10; if (mobile.tapSpacingIssues === 0) interaction += 10; else if (mobile.tapSpacingIssues <= 5) interaction += 5; else interaction -= 5; }
  if (design.consistentHeadings) consistency += 10;
  if (design.cssFramework && design.cssFramework !== 'Unknown/Other') consistency += 10;
  if (design.fontFamily && !design.fontFamily.includes(',') && !design.fontFamily.includes('serif')) consistency += 5;
  if (images?.length > 0) {
    const withAlt = images.filter((i: any) => i.hasAlt).length;
    const altPct = withAlt / images.length;
    if (altPct >= 0.9) polish += 15; else if (altPct >= 0.7) polish += 5; else polish -= 10;
    const nextGen = images.filter((i: any) => i.isNextGen).length;
    if (nextGen / images.length >= 0.5) polish += 10;
    const oversized = images.filter((i: any) => i.oversized).length;
    if (oversized > 3) polish -= 10;
  }
  if (design.hasTransitions) polish += 5;
  if (mobile?.viewportContent?.includes('width=device-width')) polish += 5;
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const scores = { typography: clamp(typography), color: clamp(color), spacing: clamp(spacing), layout: clamp(layout), interaction: clamp(interaction), consistency: clamp(consistency), polish: clamp(polish) };
  const overall = clamp(Math.round((scores.typography + scores.color + scores.spacing + scores.layout + scores.interaction + scores.consistency + scores.polish) / 7));
  return { overall, breakdown: { ...scores, overall } };
}

// ====== Build Audit ======
function buildAudit(siteAudit: any, opts: {
  screenshotDesktop: string; screenshotMobile: string; psiData: any;
  designScores?: any; mobileChecks?: any; imageIssues?: any[]; linkResults?: any; conversionData?: any; conversionScore?: any;
}): any {
  const now = Date.now();
  if (!siteAudit) return createFallbackAudit('unknown');
  const psi = opts.psiData?.lighthouseResult;
  const psiAudits = psi?.audits || {};

  let lcp = 0, cls = 0, inp = 0, fcp = 0, ttfb = 0;
  const cwv = siteAudit.lighthouse?.cwvSummary?.p50 || siteAudit.lighthouse?.pages?.[0]?.cwv;
  if (cwv) { lcp = cwv.lcp || 0; cls = cwv.cls || 0; inp = cwv.inp || 0; fcp = cwv.fcp || 0; ttfb = cwv.ttfb || 0; }
  if (lcp === 0 && psiAudits['largest-contentful-paint']) { lcp = psiAudits['largest-contentful-paint'].numericValue || 0; cls = psiAudits['cumulative-layout-shift']?.numericValue || 0; fcp = psiAudits['first-contentful-paint']?.numericValue || 0; ttfb = psiAudits['server-response-time']?.numericValue || 0; }
  if (lcp === 0 && siteAudit.crawl?.pages) {
    const pages = Array.isArray(siteAudit.crawl.pages) ? siteAudit.crawl.pages : Array.from(siteAudit.crawl.pages.values() || []);
    const avgResponse = pages.reduce((a: number, p: any) => a + (p.responseTime || 0), 0) / (pages.length || 1);
    ttfb = avgResponse; lcp = avgResponse * 2.5;
  }
  let perfScore = 0;
  const rawPerfScore = siteAudit.lighthouse?.pages?.[0]?.performanceScore ?? psi?.categories?.performance?.score;
  if (rawPerfScore !== undefined) { perfScore = rawPerfScore <= 1 ? Math.round(rawPerfScore * 100) : Math.round(rawPerfScore); }
  else if (lcp > 0) { if (lcp < 1200) perfScore = 95; else if (lcp < 2500) perfScore = 80; else if (lcp < 4000) perfScore = 50; else perfScore = 30; }
  else perfScore = 50;

  const seoPages = siteAudit.seo?.pages || [];
  const firstPage = seoPages[0] || {};
  const pageIssues = seoPages.flatMap((p: any) => p.issues || []);
  const siteLevelIssues = siteAudit.siteLevel?.issues || [];
  const allIssues = [...pageIssues, ...siteLevelIssues];
  const titles = seoPages.map((p: any) => p.title).filter(Boolean);
  const duplicateTitle = titles.length > new Set(titles).size;
  const duplicateDesc = seoPages.map((p: any) => p.metaDescription).filter(Boolean).length > new Set(seoPages.map((p: any) => p.metaDescription).filter(Boolean)).size;
  const duplicateDescription = duplicateDesc;
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

  let designScore = 65;
  let designBreakdown = { overall: 65, typography: 70, color: 60, spacing: 65, layout: 70, interaction: 60, consistency: 75, polish: 55 };
  if (opts.designScores) { designScore = opts.designScores.overall; designBreakdown = opts.designScores.breakdown; }

  let conversionScore = 50;
  let conversionBreakdown: any = null;
  if (opts.conversionScore) { conversionScore = opts.conversionScore.overall; conversionBreakdown = opts.conversionScore.breakdown; }

  let seoScore = 0;
  const rawSeoScore = psi?.categories?.seo?.score;
  if (rawSeoScore !== undefined) { seoScore = Math.round(rawSeoScore * 100); } else {
    const errorCount = allIssues.filter((i: any) => i.severity === 'error').length;
    const warningCount = allIssues.filter((i: any) => i.severity === 'warning').length;
    const infoCount = allIssues.filter((i: any) => i.severity === 'info').length;
    seoScore = Math.max(0, Math.min(100, 100 - errorCount * 5 - warningCount * 2 - infoCount * 0.5));
    if (seoScore === 100 && allIssues.length === 0 && !siteAudit.seo) seoScore = 70;
  }

  const overallScore = Math.min(100, Math.round(perfScore * 0.25 + seoScore * 0.20 + a11yScore * 0.15 + securityScore * 0.10 + designScore * 0.15 + conversionScore * 0.15));

  const redFlags: any[] = [];
  const topFixes = siteAudit.rankedFixes || [];
  for (const fix of topFixes.slice(0, 10)) {
    const severity = fix.impact === 'high' ? 'critical' : fix.impact === 'medium' ? 'high' : 'medium';
    if (severity === 'critical' || severity === 'high') redFlags.push({ severity, category: fix.category, message: fix.title, impact: fix.description, affectedUrls: fix.affectedUrls?.slice(0, 5) || [] });
  }
  if (lcp > 4000) redFlags.unshift({ severity: 'critical', category: 'performance', message: `LCP ${(lcp / 1000).toFixed(1)}s — extremely slow`, impact: 'High bounce rate, Google ranking penalty' });
  const finalBrokenInternal = opts.linkResults?.broken ?? brokenInternal;
  if (finalBrokenInternal > 20) redFlags.unshift({ severity: 'critical', category: 'links', message: `${finalBrokenInternal} broken links found`, impact: 'Lost SEO equity, users hitting 404 pages' });
  else if (finalBrokenInternal > 5) redFlags.push({ severity: 'high', category: 'links', message: `${finalBrokenInternal} broken links — needs repair`, impact: 'Users hitting dead pages, poor UX' });
  if (!hasHsts) redFlags.unshift({ severity: 'critical', category: 'security', message: 'Missing HSTS header', impact: 'Security risk, SEO downgrade' });
  if (robotsTxtDisallowAll) redFlags.unshift({ severity: 'critical', category: 'seo', message: 'robots.txt blocks all crawlers', impact: 'Zero search visibility' });
  if (lcp > 2500) redFlags.push({ severity: 'high', category: 'performance', message: `LCP ${(lcp / 1000).toFixed(1)}s — should be <2.5s`, impact: '~18% higher bounce rate per 1s delay' });
  if (inp > 200) redFlags.push({ severity: 'high', category: 'performance', message: `INP ${inp}ms — poor interactivity`, impact: 'User frustration, slower perceived performance' });
  if (!hasOpenGraph) redFlags.push({ severity: 'high', category: 'seo', message: 'Missing Open Graph tags', impact: 'Poor social sharing previews' });
  if (!structuredDataPresent) redFlags.push({ severity: 'high', category: 'seo', message: 'No structured data (schema.org)', impact: 'No rich snippets in search results' });
  if (duplicateTitle) redFlags.push({ severity: 'high', category: 'seo', message: 'Duplicate page titles', impact: 'Keyword cannibalization in search' });
  if (a11yScore < 70) redFlags.push({ severity: 'high', category: 'accessibility', message: `Accessibility score ${a11yScore}/100`, impact: 'ADA compliance risk, excludes users' });
  if (opts.mobileChecks?.smallTargets > 5) redFlags.push({ severity: 'high', category: 'accessibility', message: `${opts.mobileChecks.smallTargets} touch targets too small (<48px)`, impact: 'Poor mobile UX, users miss taps' });
  if (opts.mobileChecks?.hasOverflow) redFlags.push({ severity: 'high', category: 'design', message: 'Horizontal overflow on mobile — content wider than viewport', impact: 'Users must scroll sideways, high bounce' });
  if (opts.mobileChecks?.tapSpacingIssues > 5) redFlags.push({ severity: 'medium', category: 'design', message: `${opts.mobileChecks.tapSpacingIssues} tap targets too close together`, impact: 'Accidental taps, frustrated users' });
  if (opts.imageIssues) {
    const withoutAlt = opts.imageIssues.filter((i: any) => !i.hasAlt).length;
    if (withoutAlt > 3) redFlags.push({ severity: 'high', category: 'seo', message: `${withoutAlt} images missing alt text`, impact: 'Lost SEO, accessibility violations' });
    if (opts.imageIssues.filter((i: any) => i.oversized).length > 3) redFlags.push({ severity: 'medium', category: 'performance', message: `${opts.imageIssues.filter((i: any) => i.oversized).length} images displayed smaller than actual size`, impact: 'Wasted bandwidth, slow load' });
  }
  if (opts.conversionData) {
    const conv = opts.conversionData;
    if (!conv.hasPhone && !conv.hasEmail && conv.formCount === 0) redFlags.push({ severity: 'high', category: 'design', message: 'No visible contact info or forms', impact: 'Lost leads, visitors cannot reach the business' });
    if (conv.hasPlaceholderText) redFlags.push({ severity: 'high', category: 'design', message: 'Placeholder/Lorem ipsum text found on live site', impact: 'Unprofessional appearance, damages credibility' });
    if (conv.ctaCount === 0) redFlags.push({ severity: 'high', category: 'design', message: 'No clear call-to-action buttons found', impact: 'Visitors don\'t know what to do next' });
    if (!conv.hasFavicon) redFlags.push({ severity: 'medium', category: 'seo', message: 'Missing favicon', impact: 'Site looks incomplete in browser tabs' });
    if (conv.trustSignalCount < 2) redFlags.push({ severity: 'medium', category: 'design', message: 'Few trust signals (testimonials, reviews, certifications)', impact: 'Reduces conversion rates' });
    if (conv.detectedCMS !== 'Unknown/Other' && conv.hasStockPhotos) redFlags.push({ severity: 'medium', category: 'design', message: `Built on ${conv.detectedCMS} with stock photography`, impact: 'May look generic compared to custom designs' });
  }
  if (perfScore < 70) redFlags.push({ severity: 'medium', category: 'performance', message: `Performance ${perfScore}/100 needs work`, impact: 'Suboptimal UX and SEO' });
  if (seoScore < 70) redFlags.push({ severity: 'medium', category: 'seo', message: `SEO score ${seoScore}/100`, impact: 'Lower search rankings' });
  if (sitemapMissing) redFlags.push({ severity: 'medium', category: 'seo', message: 'No sitemap.xml found', impact: 'Slower indexing by search engines' });
  if (totalH1 === 0) redFlags.push({ severity: 'medium', category: 'seo', message: 'Missing H1 heading on homepage', impact: 'Poor content hierarchy, SEO weakness' });

  const seen = new Set<string>();
  const uniqueFlags = redFlags.filter(f => { if (seen.has(f.message)) return false; seen.add(f.message); return true; });

  return {
    performanceScore: Math.min(100, Math.max(0, perfScore)),
    seoScore: Math.min(100, Math.max(0, seoScore)),
    accessibilityScore: Math.min(100, Math.max(0, a11yScore)),
    securityScore: Math.min(100, Math.max(0, securityScore)),
    designScore: Math.min(100, Math.max(0, designScore)),
    conversionScore: Math.min(100, Math.max(0, conversionScore)),
    overallScore,
    overallGrade: getGrade(overallScore), performanceGrade: getGrade(perfScore), seoGrade: getGrade(seoScore), accessibilityGrade: getGrade(a11yScore), securityGrade: getGrade(securityScore),
    recommendations: getRecommendations({ overallScore, redFlags: uniqueFlags, links: { brokenInternal: finalBrokenInternal }, webVitals: { mobile: { lcp, cls, inp } }, security: { hsts: { present: hasHsts } } }),
    webVitals: { desktop: { lcp, cls, inp, fcp, ttfb }, mobile: { lcp, cls, inp, fcp, ttfb } },
    seo: { title: { present: !!firstPage.title, length: firstPage.title?.length || 0, value: firstPage.title || null }, metaDescription: { present: !!firstPage.metaDescription, length: firstPage.metaDescription?.length || 0, value: firstPage.metaDescription || null }, h1: { present: totalH1 > 0, count: totalH1 }, canonical: { present: hasCanonical, value: firstPage.canonicalUrl || null }, openGraph: { present: hasOpenGraph }, structuredData: { present: structuredDataPresent, type: 'unknown', errors: [] }, robotsTxt: { present: !robotsTxtMissing, content: null }, sitemap: { present: !sitemapMissing, url: null }, duplicateTitle, duplicateDescription, thinContent },
    accessibility: { score: a11yScore, violations: a11yIssues.map((i: any) => ({ id: i.rule, impact: mapImpact(i.severity), description: i.message })), langAttribute: !langMissing, viewportMeta: !viewportMissing, altImages: opts.imageIssues?.filter((i: any) => i.hasAlt).length || 0, ariaLabels: 0 },
    security: { score: securityScore, hsts: { present: hasHsts, maxAge: 0 }, csp: { present: hasCsp, value: '' }, xFrameOptions: { present: hasXfo, value: '' }, xContentTypeOptions: { present: hasXcto }, referrerPolicy: { present: false, value: '' }, permissionsPolicy: { present: false, value: '' } },
    links: { totalInternal, totalExternal, brokenInternal: finalBrokenInternal, brokenExternal, redirectChains, orphanPages, linkCheckTotal: opts.linkResults?.total || 0, linkCheckBroken: opts.linkResults?.broken || 0 },
    design: designBreakdown,
    conversion: { score: conversionScore, breakdown: conversionBreakdown, raw: opts.conversionData },
    screenshotDesktop: opts.screenshotDesktop || undefined,
    screenshotMobile: opts.screenshotMobile || undefined,
    pagesCrawled: siteAudit.crawl?.totalPages ?? (pages.length || 1),
    crawlDuration: siteAudit.crawl?.elapsedMs ? Math.round(siteAudit.crawl.elapsedMs / 1000) : 0,
    timestamp: now,
    redFlags: uniqueFlags.slice(0, 15),
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
  const overall = audit.overallScore, redFlagCount = audit.redFlags?.filter((f: any) => f.severity === 'critical' || f.severity === 'high').length || 0, brokenLinks = audit.links?.brokenInternal || 0, lcp = audit.webVitals?.mobile?.lcp || 0;
  let priority: 'low' | 'medium' | 'high' | 'critical' = 'low';
  let suggestedServices: string[] = [], expectedImpact: 'low' | 'medium' | 'high' = 'medium', downloadReport = false;
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
  const start = stdout.indexOf('{'), end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1) return stdout;
  return stdout.substring(start, end + 1);
}

function createFallbackAudit(url: string, extractedData?: any) {
  let perfScore = 50, seoScore = 50, a11yScore = 50, securityScore = 50, designScore = 60, conversionScore = 50;
  const title = extractedData?.title || '', desc = extractedData?.metaDescription || '', h1Count = extractedData?.h1Count || 0;
  const hasCanonical = !!extractedData?.hasCanonical, hasLang = !!extractedData?.hasLang, hasViewport = !!extractedData?.hasViewport;
  const hsts = !!extractedData?.headers?.hsts, csp = !!extractedData?.headers?.csp;
  if (title.length > 10 && desc.length > 20) seoScore += 20;
  if (h1Count > 0) seoScore += 10;
  if (hasCanonical) seoScore += 10;
  if (hsts) securityScore += 20;
  if (csp) securityScore += 20;
  if (hasLang) a11yScore += 20;
  if (hasViewport) a11yScore += 20;
  const overallScore = Math.round((perfScore + seoScore + a11yScore + securityScore + designScore + conversionScore) / 6);
  return {
    performanceScore: perfScore, seoScore, accessibilityScore: a11yScore, securityScore, designScore, conversionScore, overallScore,
    overallGrade: getGrade(overallScore), performanceGrade: getGrade(perfScore), seoGrade: getGrade(seoScore), accessibilityGrade: getGrade(a11yScore), securityGrade: getGrade(securityScore),
    recommendations: { downloadReport: true, priority: overallScore < 60 ? 'high' : 'medium', suggestedServices: ['Technical SEO Audit', 'Performance Optimization'], expectedImpact: 'high', estimatedEffort: 'medium' },
    webVitals: { desktop: { lcp: 2500, cls: 0.1, inp: 200, fcp: 1500, ttfb: 500 }, mobile: { lcp: 3000, cls: 0.15, inp: 250, fcp: 2000, ttfb: 600 } },
    seo: { title: { present: !!title, value: title, length: title.length }, metaDescription: { present: !!desc, value: desc, length: desc.length }, h1: { present: h1Count > 0, count: h1Count }, canonical: { present: hasCanonical }, openGraph: { present: !!extractedData?.hasOpenGraph }, structuredData: { present: false, errors: [] }, robotsTxt: { present: true }, sitemap: { present: true }, duplicateTitle: false, duplicateDescription: false, thinContent: false },
    accessibility: { score: a11yScore, violations: [{ id: 'fallback', impact: 'moderate', description: 'Limited check' }], langAttribute: hasLang, viewportMeta: hasViewport, altImages: 0, ariaLabels: 0 },
    security: { score: securityScore, hsts: { present: hsts }, csp: { present: csp }, xFrameOptions: { present: !!extractedData?.headers?.xfo }, xContentTypeOptions: { present: !!extractedData?.headers?.xcto }, referrerPolicy: { present: false }, permissionsPolicy: { present: false } },
    links: { totalInternal: extractedData?.internalLinks || 0, totalExternal: extractedData?.externalLinks || 0, brokenInternal: 0, brokenExternal: 0, redirectChains: [], orphanPages: [] },
    design: { overall: 60, typography: 60, color: 60, spacing: 60, layout: 60, interaction: 60, consistency: 60, polish: 60 },
    conversion: { score: conversionScore, breakdown: null, raw: {} },
    screenshotDesktop: '', screenshotMobile: '', pagesCrawled: 1, crawlDuration: 5, timestamp: Date.now(),
    redFlags: [{ severity: 'high', category: 'system', message: '⚠ Fallback mode: deep audit unavailable', impact: 'Scores are estimated' }], raw: null
  };
}
