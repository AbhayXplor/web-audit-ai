import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const { lead, audit, enrichment } = await req.json();
        if (!lead || !audit) {
            return NextResponse.json({ error: 'lead and audit data required' }, { status: 400 });
        }

        const gradeColors: Record<string, string> = {
            A: '#10b981', B: '#3b82f6', C: '#f59e0b', D: '#f43f5e', F: '#64748b'
        };
        const gc = (g: string) => gradeColors[g] || '#64748b';

        // Build HTML report
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page { margin: 20mm 15mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; line-height: 1.5; }
  .cover { text-align: center; padding: 60px 0 40px; border-bottom: 3px solid #3b82f6; margin-bottom: 30px; }
  .cover h1 { font-size: 28px; margin: 0 0 5px; color: #0f172a; }
  .cover .url { font-size: 14px; color: #3b82f6; margin: 0 0 20px; }
  .cover .score-circle { width: 120px; height: 120px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 36px; font-weight: bold; color: white; margin: 10px 0; }
  .section { margin: 25px 0; }
  .section h2 { font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px; color: #0f172a; }
  .grid-5 { display: flex; gap: 10px; flex-wrap: wrap; }
  .card { flex: 1; min-width: 80px; padding: 12px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0; }
  .card .score { font-size: 22px; font-weight: bold; }
  .card .label { font-size: 11px; color: #64748b; margin-top: 4px; }
  .card .grade { font-size: 14px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { padding: 8px 10px; border: 1px solid #e2e8f0; text-align: left; }
  th { background: #f8fafc; font-weight: 600; }
  .flag { padding: 6px 10px; border-radius: 4px; margin: 4px 0; font-size: 12px; }
  .flag-critical { background: #fef2f2; border-left: 3px solid #f43f5e; }
  .flag-high { background: #fffbeb; border-left: 3px solid #f59e0b; }
  .flag-medium { background: #eff6ff; border-left: 3px solid #3b82f6; }
  .row { display: flex; gap: 20px; }
  .col { flex: 1; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .badge-green { background: #dcfce7; color: #166534; }
  .badge-red { background: #fef2f2; color: #991b1b; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
</style>
</head>
<body>
<div class="cover">
  <h1>${escapeHtml(lead.name)}</h1>
  <p class="url">${escapeHtml(lead.website || '')}</p>
  ${lead.category ? `<p style="font-size:13px;color:#64748b">${escapeHtml(lead.category)}</p>` : ''}
  <div class="score-circle" style="background:${gc(audit.overallGrade)}">${audit.overallScore}</div>
  <div style="font-size:14px;color:#64748b;margin-top:5px">Overall Health — Grade ${audit.overallGrade}</div>
</div>

<div class="section">
  <h2>Scores</h2>
  <div class="grid-5">
    ${['Performance', 'SEO', 'Accessibility', 'Security', 'Design'].map((name, i) => {
            const key = name.toLowerCase() + 'Score';
            const gradeKey = name.toLowerCase() + 'Grade';
            const score = audit[key] || 0;
            const grade = audit[gradeKey] || 'F';
            return `<div class="card"><div class="grade" style="color:${gc(grade)}">${grade}</div><div class="score" style="color:${gc(grade)}">${score}</div><div class="label">${name}</div></div>`;
        }).join('')}
  </div>
</div>

<div class="section">
  <h2>Core Web Vitals</h2>
  <table>
    <tr><th>Metric</th><th>Mobile</th><th>Desktop</th><th>Status</th></tr>
    ${['lcp', 'cls', 'inp', 'fcp', 'ttfb'].map(m => {
            const mobileVal = audit.webVitals?.mobile?.[m];
            const desktopVal = audit.webVitals?.desktop?.[m];
            const isGood = m === 'lcp' ? mobileVal < 2500 : m === 'cls' ? mobileVal < 0.1 : m === 'inp' ? mobileVal < 200 : true;
            const label = m.toUpperCase();
            const mobileStr = m === 'cls' ? mobileVal?.toFixed(3) : `${Math.round(mobileVal || 0)}${m === 'cls' ? '' : 'ms'}`;
            const desktopStr = m === 'cls' ? desktopVal?.toFixed(3) : `${Math.round(desktopVal || 0)}${m === 'cls' ? '' : 'ms'}`;
            return `<tr><td><strong>${label}</strong></td><td>${mobileStr || 'N/A'}</td><td>${desktopStr || 'N/A'}</td><td><span class="badge ${isGood ? 'badge-green' : 'badge-red'}">${isGood ? 'PASS' : 'FAIL'}</span></td></tr>`;
        }).join('')}
  </table>
</div>

${audit.redFlags && audit.redFlags.length > 0 ? `<div class="section"><h2>Issues Detected (${audit.redFlags.length})</h2>${audit.redFlags.slice(0, 15).map((f: any) =>
            `<div class="flag flag-${f.severity}"><strong>[${f.severity.toUpperCase()}]</strong> ${escapeHtml(f.message)}<br><span style="font-size:11px;color:#64748b">${escapeHtml(f.impact || '')}</span></div>`
        ).join('')}</div>` : ''}

<div class="row">
  ${audit.seo ? `<div class="col section"><h2>SEO</h2><table>
    <tr><td>Title</td><td>${audit.seo.title?.present ? `${audit.seo.title?.length} chars` : 'MISSING'}</td></tr>
    <tr><td>Meta Description</td><td>${audit.seo.metaDescription?.present ? `${audit.seo.metaDescription?.length} chars` : 'MISSING'}</td></tr>
    <tr><td>H1 Tags</td><td>${audit.seo.h1?.count || 0}</td></tr>
    <tr><td>Canonical</td><td>${audit.seo.canonical?.present ? '✓' : '✗'}</td></tr>
    <tr><td>Open Graph</td><td>${audit.seo.openGraph?.present ? '✓' : '✗'}</td></tr>
    <tr><td>Structured Data</td><td>${audit.seo.structuredData?.present ? '✓' : '✗'}</td></tr>
    <tr><td>Sitemap</td><td>${audit.seo.sitemap?.present ? '✓' : '✗'}</td></tr>
    <tr><td>Robots.txt</td><td>${audit.seo.robotsTxt?.present ? '✓' : '✗'}</td></tr>
  </table></div>` : ''}
  ${audit.links ? `<div class="col section"><h2>Links</h2><table>
    <tr><td>Total Internal</td><td>${audit.links.totalInternal || 0}</td></tr>
    <tr><td>Broken Internal</td><td style="color:${(audit.links.brokenInternal || 0) > 0 ? '#f43f5e' : '#166534'}">${audit.links.brokenInternal || 0}</td></tr>
    <tr><td>Broken External</td><td>${audit.links.brokenExternal || 0}</td></tr>
    <tr><td>Redirect Chains</td><td>${audit.links.redirectChains?.length || 0}</td></tr>
    <tr><td>Orphan Pages</td><td>${audit.links.orphanPages?.length || 0}</td></tr>
    ${audit.links.linkCheckBroken !== undefined ? `<tr><td>Verified Broken</td><td style="color:${audit.links.linkCheckBroken > 0 ? '#f43f5e' : '#166534'}">${audit.links.linkCheckBroken} of ${audit.links.linkCheckTotal || 0}</td></tr>` : ''}
  </table></div>` : ''}
</div>

${audit.mobileChecks ? `<div class="section"><h2>Mobile Responsiveness</h2><table>
  <tr><td>Viewport Meta</td><td>${audit.mobileChecks.viewportContent || 'MISSING'}</td></tr>
  <tr><td>Horizontal Overflow</td><td style="color:${audit.mobileChecks.hasOverflow ? '#f43f5e' : '#166534'}">${audit.mobileChecks.hasOverflow ? 'YES — content wider than screen' : 'None'}</td></tr>
  <tr><td>Small Tap Targets</td><td style="color:${(audit.mobileChecks.smallTargets || 0) > 5 ? '#f43f5e' : '#166534'}">${audit.mobileChecks.smallTargets || 0}</td></tr>
  <tr><td>Font Size (body)</td><td>${audit.mobileChecks.bodyFontSize || 'N/A'}px</td></tr>
  <tr><td>Elements with font < 12px</td><td>${audit.mobileChecks.smallFonts || 0}</td></tr>
</table></div>` : ''}

${audit.design ? `<div class="section"><h2>Design Analysis</h2><table>
  ${Object.entries(audit.design).filter(([k]) => k !== 'overall').map(([k, v]) =>
            `<tr><td style="text-transform:capitalize">${k}</td><td>${v}/100</td></tr>`
        ).join('')}
</table></div>` : ''}

${enrichment ? `<div class="section"><h2>AI Sales Intelligence</h2>
  <table><tr><td><strong>Summary</strong></td><td>${escapeHtml(enrichment.summary || '')}</td></tr></table>
  ${enrichment.riskFactors?.length ? `<h3 style="font-size:14px;margin:15px 0 8px">Risk Factors</h3><ul>${enrichment.riskFactors.map((r: string) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
  ${enrichment.valueGaps?.length ? `<h3 style="font-size:14px;margin:15px 0 8px">Value Gaps</h3><ul>${enrichment.valueGaps.map((r: string) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
  ${enrichment.salesHooks?.length ? `<h3 style="font-size:14px;margin:15px 0 8px">Sales Hooks</h3><ul>${enrichment.salesHooks.map((r: string) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
  ${enrichment.recommendedServices?.length ? `<h3 style="font-size:14px;margin:15px 0 8px">Recommended Services</h3><p>${enrichment.recommendedServices.join(', ')}</p>` : ''}
</div>` : ''}

<div class="footer">
  Generated by Web Audit AI • ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}<br>
  Pages Crawled: ${audit.pagesCrawled || 1} • Crawl Duration: ${audit.crawlDuration || 0}s
</div>
</body></html>`;

        return new NextResponse(html, {
            headers: {
                'Content-Type': 'text/html',
                'Content-Disposition': `attachment; filename="audit-report-${lead.name?.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_')}.html"`
            }
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

function escapeHtml(text: string): string {
    if (!text) return '';
    return text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}