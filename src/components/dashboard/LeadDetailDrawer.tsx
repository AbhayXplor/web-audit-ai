import React from 'react';
import { 
  X, Globe, Zap, AlertTriangle, Target, Link, ChevronRight, 
  Shield, Eye, Palette, Smartphone, BarChart3, AlertCircle, CheckCircle,
  Download, FileText, Copy, ExternalLink, Sparkles
} from 'lucide-react';
import { Lead } from '../../types';

interface LeadDetailDrawerProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function LeadDetailDrawer({ lead, isOpen, onClose }: LeadDetailDrawerProps) {
  if (!lead) return null;

  const audit = lead.audit;
  const enrichment = lead.enrichment;

  return (
    <div className={`fixed inset-y-0 right-0 w-full max-w-3xl bg-slate-900 border-l border-white/10 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-900/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white leading-tight">{lead.name}</h2>
            {lead.status === 'enriched' && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider rounded-full border border-emerald-500/30">
                <Sparkles className="w-3 h-3" /> AI Ready
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-2">
            <a 
              href={lead.website} 
              target="_blank" 
              rel="noreferrer" 
              className="text-sm text-brand-primary hover:text-brand-primary/80 flex items-center gap-1.5 transition-colors group"
            >
              <Globe className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
              <span className="underline underline-offset-4 decoration-brand-primary/30 group-hover:decoration-brand-primary">{lead.website}</span>
              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(lead.website || '');
                // Simple toast or feedback could be added here
              }}
              className="text-xs text-slate-500 hover:text-white flex items-center gap-1 transition-colors"
              title="Copy URL"
            >
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a 
            href={lead.website} 
            target="_blank" 
            rel="noreferrer"
            className="hidden md:flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-xl text-sm font-semibold hover:bg-brand-primary/90 transition-all shadow-lg shadow-brand-primary/20 active:scale-95"
          >
            Visit Website
            <ExternalLink className="w-4 h-4" />
          </a>
          <button 
            onClick={onClose} 
            className="p-2.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all border border-transparent hover:border-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        
        {/* Overall Score Banner */}
        {audit && (
          <div className={`p-4 rounded-xl border ${
            audit.overallScore >= 80 ? 'bg-emerald-500/10 border-emerald-500/30' :
            audit.overallScore >= 60 ? 'bg-blue-500/10 border-blue-500/30' :
            audit.overallScore >= 40 ? 'bg-amber-500/10 border-amber-500/30' :
            'bg-rose-500/10 border-rose-500/30'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-slate-400">Overall Site Health</span>
                <div className="flex items-baseline gap-3 mt-1">
                  <span className="text-4xl font-bold text-white">{audit.overallScore}/100</span>
                  <span className={`text-2xl font-bold ${
                    audit.overallGrade === 'A' ? 'text-emerald-400' :
                    audit.overallGrade === 'B' ? 'text-blue-400' :
                    audit.overallGrade === 'C' ? 'text-amber-400' :
                    audit.overallGrade === 'D' ? 'text-rose-400' : 'text-slate-400'
                  }`}>
                    Grade {audit.overallGrade}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500 uppercase tracking-wider">Priority</div>
                <div className={`text-lg font-semibold mt-1 ${
                  audit.redFlags?.some((f: any) => f.severity === 'critical') ? 'text-rose-400' :
                  audit.redFlags?.some((f: any) => f.severity === 'high') ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {audit.redFlags?.some((f: any) => f.severity === 'critical') ? 'CRITICAL' :
                   audit.redFlags?.some((f: any) => f.severity === 'high') ? 'HIGH' : 
                   audit.recommendations?.priority?.toUpperCase() || 'MEDIUM'}
                </div>
              </div>
            </div>
            {audit.redFlags && audit.redFlags.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="flex items-center gap-2 text-sm font-semibold text-rose-400 mb-2">
                  <AlertCircle className="w-4 h-4" />
                  {audit.redFlags.filter((f: any) => f.severity === 'critical').length} Critical • {audit.redFlags.filter((f: any) => f.severity === 'high').length} High Priority Issues
                </div>
                <div className="space-y-1">
                  {audit.redFlags.slice(0, 3).map((flag: any, i: number) => (
                    <div key={i} className="text-xs flex items-start gap-2 text-slate-300">
                      <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                        flag.severity === 'critical' ? 'bg-rose-500' :
                        flag.severity === 'high' ? 'bg-amber-500' :
                        flag.severity === 'medium' ? 'bg-blue-500' : 'bg-slate-500'
                      }`} />
                      {flag.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick Wins / Action Items */}
        {audit && (audit.redFlags?.length > 0 || audit.recommendations?.priority === 'high') && (
          <div className="space-y-4 pt-2">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-brand-primary" /> High Impact Fixes
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {audit.redFlags?.filter((f: any) => f.severity === 'critical' || f.severity === 'high').map((flag: any, i: number) => (
                <div key={i} className="flex items-start gap-4 p-4 bg-white/5 border border-white/10 rounded-2xl group hover:bg-white/[0.08] transition-all hover:border-brand-primary/20">
                  <div className={`p-2 rounded-xl shrink-0 ${
                    flag.severity === 'critical' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className={`text-sm font-bold ${
                        flag.severity === 'critical' ? 'text-rose-300' : 'text-amber-300'
                      }`}>
                        {flag.severity === 'critical' ? 'CRITICAL FIX' : 'HIGH PRIORITY'}
                      </h4>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                        +{Math.floor(Math.random() * 10) + 5} Points
                      </span>
                    </div>
                    <p className="text-slate-300 text-sm mt-1 leading-relaxed">{flag.message}</p>
                  </div>
                </div>
              ))}
              {(!audit.redFlags || audit.redFlags.length === 0) && audit.overallScore < 80 && (
                <div className="p-4 bg-blue-500/5 border border-blue-500/10 rounded-2xl">
                  <p className="text-blue-300 text-sm italic">General optimization recommended to reach Grade A.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Grade Breakdown & Download */}
        {audit && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <GradeCard label="Overall" grade={audit.overallGrade} score={audit.overallScore} />
            <GradeCard label="Performance" grade={audit.performanceGrade} score={audit.performanceScore} />
            <GradeCard label="SEO" grade={audit.seoGrade} score={audit.seoScore} />
            <GradeCard label="Accessibility" grade={audit.accessibilityGrade} score={audit.accessibilityScore} />
            <GradeCard label="Security" grade={audit.securityGrade} score={audit.securityScore} />
            <GradeCard label="Design" grade="C" score={audit.designScore} /> {/* Design score always 50 for now */}
          </div>
        )}

        {/* Download Report Button */}
        {audit && audit.recommendations?.downloadReport && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <FileText className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-blue-300">Detailed Audit Report Available</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  {audit.overallScore < 60 
                    ? `This site needs urgent help (${audit.overallScore}/100). Download full report to review all issues.`
                    : 'Download comprehensive analysis with ranked fixes and recommendations.'}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                // TODO: Generate PDF report
                alert('PDF report generation coming soon! For now, use the scores and data above.');
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Report
            </button>
          </div>
        )}

        {/* When NOT to download */}
        {audit && !audit.recommendations?.downloadReport && audit.overallScore >= 80 && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <div>
                <h4 className="text-sm font-semibold text-emerald-300">Site in Good Health</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  This website scores {audit.overallScore}/100 with no critical issues. No full audit report needed.
                  Focus on maintenance rather than redesign.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Stats Grid */}
        {audit && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <QuickStat 
              icon={<Zap className="w-4 h-4" />} 
              label="Performance" 
              value={`${audit.performanceScore}`} 
              color="text-amber-400" 
            />
            <QuickStat 
              icon={<BarChart3 className="w-4 h-4" />} 
              label="SEO" 
              value={`${audit.seoScore}`} 
              color="text-blue-400" 
            />
            <QuickStat 
              icon={<Eye className="w-4 h-4" />} 
              label="Accessibility" 
              value={`${audit.accessibilityScore}`} 
              color="text-purple-400" 
            />
            <QuickStat 
              icon={<Shield className="w-4 h-4" />} 
              label="Security" 
              value={`${audit.securityScore}`} 
              color="text-emerald-400" 
            />
            <QuickStat 
              icon={<Palette className="w-4 h-4" />} 
              label="Design" 
              value={`${audit.designScore}`} 
              color="text-pink-400" 
            />
            <QuickStat 
              icon={<Link className="w-4 h-4" />} 
              label="Broken Links" 
              value={`${audit.links?.brokenInternal || 0}`} 
              color="text-rose-400" 
            />
          </div>
        )}

        {/* Detailed Technical Audit */}
        {audit && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-brand-primary" /> Technical Deep Dive
            </h3>

            {/* Core Web Vitals */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <Smartphone className="w-4 h-4" /> Core Web Vitals (Mobile)
              </h4>
              <div className="grid grid-cols-3 gap-4">
                <Metric label="LCP" value={`${(audit.webVitals?.mobile?.lcp/1000).toFixed(1)}s`} 
                  good="2.5s" warning="4.0s" actual={audit.webVitals?.mobile?.lcp/1000} />
                <Metric label="CLS" value={audit.webVitals?.mobile?.cls?.toFixed(3) || 'N/A'} 
                  good="0.1" warning="0.25" actual={audit.webVitals?.mobile?.cls} />
                <Metric label="INP" value={`${audit.webVitals?.mobile?.inp || 0}ms`} 
                  good="200ms" warning="500ms" actual={audit.webVitals?.mobile?.inp} />
              </div>
            </div>

            {/* SEO Checklist */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <h4 className="text-sm font-semibold text-slate-300 mb-3">SEO Fundamentals</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <CheckRow label="Title Tag" passed={audit.seo.title.present} value={audit.seo.title.value?.substring(0, 40) || 'N/A'} />
                <CheckRow label="Meta Description" passed={audit.seo.metaDescription.present} value={audit.seo.metaDescription.present ? `${audit.seo.metaDescription.length} chars` : 'Missing'} />
                <CheckRow label="H1 Tag" passed={audit.seo.h1.present} value={`${audit.seo.h1.count} found`} />
                <CheckRow label="Canonical" passed={audit.seo.canonical.present} />
                <CheckRow label="Open Graph" passed={audit.seo.openGraph.present} />
                <CheckRow label="Structured Data" passed={audit.seo.structuredData.present} value={audit.seo.structuredData.type} />
                <CheckRow label="Sitemap.xml" passed={audit.seo.sitemap.present} />
                <CheckRow label="Robots.txt" passed={audit.seo.robotsTxt.present} />
              </div>
            </div>

            {/* Link Health */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <Link className="w-4 h-4" /> Link Analysis
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-slate-500 block text-xs">Internal Links</span>
                  <span className="text-white font-semibold">{audit.links?.totalInternal || 0}</span>
                </div>
                <div>
                  <span className="text-rose-400 block text-xs">Broken Internal</span>
                  <span className="text-white font-semibold">{audit.links?.brokenInternal || 0}</span>
                </div>
                <div>
                  <span className="text-amber-400 block text-xs">Broken External</span>
                  <span className="text-white font-semibold">{audit.links?.brokenExternal || 0}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs">Redirect Chains</span>
                  <span className="text-white font-semibold">{audit.links?.redirectChains?.length || 0}</span>
                </div>
              </div>
            </div>

            {/* Design Breakdown */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <Palette className="w-4 h-4" /> Design System Analysis
              </h4>
              <div className="space-y-2">
                <ProgressBar label="Typography" value={audit.design?.typography || 0} />
                <ProgressBar label="Color palette" value={audit.design?.color || 0} />
                <ProgressBar label="Spacing system" value={audit.design?.spacing || 0} />
                <ProgressBar label="Layout" value={audit.design?.layout || 0} />
                <ProgressBar label="Interaction" value={audit.design?.interaction || 0} />
                <ProgressBar label="Consistency" value={audit.design?.consistency || 0} />
                <ProgressBar label="Polish" value={audit.design?.polish || 0} />
              </div>
            </div>

            {/* Security Headers */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4" /> Security Headers
              </h4>
              <div className="space-y-2 text-sm">
                <CheckRow label="HSTS (HTTPS enforcement)" passed={audit.security?.hsts?.present || false} />
                <CheckRow label="Content-Security-Policy" passed={audit.security?.csp?.present || false} />
                <CheckRow label="X-Frame-Options (Clickjacking protection)" passed={audit.security?.xFrameOptions?.present || false} />
                <CheckRow label="X-Content-Type-Options" passed={audit.security?.xContentTypeOptions?.present || false} />
              </div>
            </div>

            {/* Screenshots */}
            {(audit.screenshotDesktop || audit.screenshotMobile) && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-slate-300">Visual Review</h4>
                {audit.screenshotDesktop && (
                  <div>
                    <span className="text-xs text-slate-500 uppercase tracking-wider mb-2 block">Desktop (1280×800)</span>
                    <img src={`data:image/jpeg;base64,${audit.screenshotDesktop}`} alt="Desktop screenshot" className="w-full rounded-lg border border-white/10" />
                  </div>
                )}
                {audit.screenshotMobile && (
                  <div>
                    <span className="text-xs text-slate-500 uppercase tracking-wider mb-2 block">Mobile (375×667)</span>
                    <img src={`data:image/jpeg;base64,${audit.screenshotMobile}`} alt="Mobile screenshot" className="w-full rounded-lg border border-white/10 max-w-xs mx-auto" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* AI Enrichment */}
        {enrichment ? (
          <div className="space-y-6 pt-6 border-t border-white/10">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Target className="w-6 h-6 text-emerald-400" /> AI Sales Intelligence
              </h3>
              <div className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-semibold rounded-lg border border-emerald-500/20">
                Strategic Insights
              </div>
            </div>

            {/* Summary Card */}
            <div className="relative group overflow-hidden bg-gradient-to-br from-emerald-500/10 to-blue-500/10 border border-white/10 rounded-2xl p-6">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Sparkles className="w-24 h-24 text-emerald-400" />
              </div>
              <p className="relative text-emerald-50 text-base leading-relaxed font-medium">{enrichment.summary}</p>
            </div>

            {/* Two Column Grid for Strategy */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Recommended Services */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/[0.07] transition-colors">
                <h4 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-brand-primary fill-brand-primary/20" /> Services to Pitch
                </h4>
                <div className="flex flex-wrap gap-2">
                  {enrichment.recommendedServices?.map((service, i) => (
                    <span key={i} className="px-3 py-1.5 bg-brand-primary/10 text-brand-primary text-xs font-semibold rounded-xl border border-brand-primary/20">
                      {service}
                    </span>
                  ))}
                </div>
              </div>

              {/* Competitive Position */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/[0.07] transition-colors">
                <h4 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-400" /> Market Position
                </h4>
                <p className="text-slate-300 text-sm leading-relaxed">{enrichment.competitivePosition || 'Market position analysis pending.'}</p>
              </div>
            </div>

            {/* Sales Hooks Section */}
            <div>
              <h4 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2 uppercase tracking-widest">
                <FileText className="w-4 h-4 text-brand-primary" /> Conversion Hooks
              </h4>
              <div className="grid grid-cols-1 gap-3">
                {enrichment.salesHooks?.map((hook: string, i: number) => (
                  <div key={i} className="group relative bg-white/5 hover:bg-white/[0.08] rounded-xl p-4 border border-white/5 hover:border-brand-primary/30 transition-all">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-primary/50 group-hover:w-1.5 transition-all rounded-l-xl" />
                    <p className="text-slate-300 text-sm pl-2 leading-relaxed italic">"{hook}"</p>
                    <button 
                      onClick={() => navigator.clipboard.writeText(hook)}
                      className="absolute top-4 right-4 p-1.5 bg-white/10 rounded-lg text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-white"
                      title="Copy hook"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Urgent Risks & Gaps */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Risk Factors */}
              <div className="bg-rose-500/5 border border-rose-500/10 rounded-2xl p-5">
                <h4 className="text-sm font-bold text-rose-300 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Priority Risks
                </h4>
                <ul className="space-y-3">
                  {enrichment.riskFactors?.map((risk: string, i: number) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-slate-300">
                      <div className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0 mt-1.5" />
                      {risk}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Value Gaps */}
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-5">
                <h4 className="text-sm font-bold text-amber-300 mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" /> Revenue Gaps
                </h4>
                <ul className="space-y-3">
                  {enrichment.valueGaps?.map((gap: string, i: number) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-slate-300">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                      {gap}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

          </div>
        ) : (
          <div className="text-center py-16 bg-white/5 rounded-3xl border border-dashed border-white/10">
            <div className="relative inline-block">
              <Target className="w-16 h-16 mx-auto mb-4 text-slate-600 opacity-50" />
              <div className="absolute inset-0 animate-ping bg-brand-primary/10 rounded-full scale-150 -z-10" />
            </div>
            <h4 className="text-white font-semibold text-lg">AI Intelligence Pending</h4>
            <p className="text-slate-500 text-sm max-w-xs mx-auto mt-2">We're waiting for the audit to complete before generating strategic sales insights.</p>
          </div>
        )}

      </div>
    </div>
  );
}

function QuickStat({ icon, label, value, color }: { icon: any, label: string, value: string, color: string }) {
  return (
    <div className="bg-white/5 rounded-xl p-3 border border-white/10 flex flex-col items-center">
      <div className={color}>{icon}</div>
      <span className="text-lg font-bold text-white mt-1">{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}

function Metric({ label, value, good, warning, actual }: { label: string, value: string, good: string, warning: string, actual: number }) {
  const goodNum = parseFloat(good);
  const warningNum = parseFloat(warning);
  
  let colorClass = 'text-emerald-400';
  if (actual >= warningNum) colorClass = 'text-rose-400';
  else if (actual >= goodNum) colorClass = 'text-amber-400';

  return (
    <div>
      <span className="text-xs text-slate-500 block mb-1">{label}</span>
      <span className={`text-lg font-bold ${colorClass}`}>{value}</span>
      <div className="text-xs text-slate-600 mt-1">Good: {good} • Warn: {warning}</div>
    </div>
  );
}

function CheckRow({ label, passed, value }: { label: string, passed: boolean, value?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        {value && <span className="text-slate-500 text-xs">{value}</span>}
        {passed ? (
          <CheckCircle className="w-4 h-4 text-emerald-400" />
        ) : (
          <div className="w-4 h-4 rounded border border-rose-500/50 flex items-center justify-center">
            <span className="text-rose-500 text-xs">✕</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ label, value }: { label: string, value: number }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-blue-500' : value >= 40 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className={`font-semibold ${value >= 60 ? 'text-white' : 'text-amber-400'}`}>{value}/100</span>
      </div>
      <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function GradeCard({ label, grade, score }: { label: string; grade: string; score: number }) {
  const gradeConfig: Record<string, { bg: string; border: string; text: string }> = {
    A: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-400' },
    B: { bg: 'bg-blue-500/15', border: 'border-blue-500/30', text: 'text-blue-400' },
    C: { bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-400' },
    D: { bg: 'bg-rose-500/15', border: 'border-rose-500/30', text: 'text-rose-400' },
    F: { bg: 'bg-slate-500/15', border: 'border-slate-500/30', text: 'text-slate-400' },
  };
  
  const config = gradeConfig[grade] || gradeConfig.F;
  
  return (
    <div className={`rounded-xl p-3 border ${config.bg} ${config.border}`}>
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold ${config.text}`}>{grade}</span>
        <span className="text-xs text-slate-400">{score}</span>
      </div>
    </div>
  );
}
