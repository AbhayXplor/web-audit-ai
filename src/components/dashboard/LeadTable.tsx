"use client";

import React from 'react';
import { Globe, Star, MapPin, CheckCircle2, Clock, Zap, ExternalLink } from 'lucide-react';
import { Lead } from '../../types';

interface LeadTableProps {
  leads: Lead[];
  onUpdateLead?: (id: string, updates: Partial<Lead>) => void;
  onSelectLead?: (lead: Lead) => void;
  onDeleteLead?: (id: string) => void;
  auditMode?: 'fast' | 'balanced' | 'deep';
}

export default function LeadTable(
  { leads, onUpdateLead, onSelectLead, onDeleteLead, auditMode = 'balanced' }: LeadTableProps
) {
  const handleAction = async (lead: Lead) => {
    if (lead.status === 'enriched' && onSelectLead) {
      onSelectLead(lead);
      return;
    }

    if (!onUpdateLead) return;

    if (lead.status === 'new' || !lead.audit) {
      // Run Audit
      try {
        onUpdateLead(lead.id, { status: 'auditing' });

        const auditRes = await fetch('/api/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: lead.website || `https://${lead.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
            mode: auditMode
          })
        });

        const responseData = await auditRes.json();

        if (!auditRes.ok) {
          throw new Error(responseData.error || responseData.details || 'Audit failed');
        }

        onUpdateLead(lead.id, {
          status: 'audited',
          audit: responseData.audit
        });
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err ?? 'Unknown error');
        console.error('Audit error:', err);
        alert(`Audit failed: ${error}. Lead state reset to New — please retry.`);
        onUpdateLead(lead.id, { status: 'new' });
      }
    } else if (lead.status === 'audited' || !lead.enrichment) {
      // Run Enrich
      try {
        onUpdateLead(lead.id, { status: 'enriching' });

        // Prune audit data to avoid payload limits
        const prunedAudit = lead.audit ? JSON.parse(JSON.stringify(lead.audit)) : null;
        if (prunedAudit) {
          delete prunedAudit.raw;
          delete prunedAudit.screenshotMobile;
          delete prunedAudit._designMetrics;
          delete prunedAudit._conversion;
          delete prunedAudit._mobileChecks;
          delete prunedAudit._linkCheck;
          if (prunedAudit.links?.redirectChains) prunedAudit.links.redirectChains = prunedAudit.links.redirectChains.slice(0, 50);
          if (prunedAudit.links?.orphanPages) prunedAudit.links.orphanPages = prunedAudit.links.orphanPages.slice(0, 50);
          if (prunedAudit.accessibility?.violations) prunedAudit.accessibility.violations = prunedAudit.accessibility.violations.slice(0, 50);
        }

        const enrichRes = await fetch('/api/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead: {
              id: lead.id,
              name: lead.name,
              website: lead.website,
              category: lead.category,
              rating: lead.rating,
              reviews: lead.reviews,
              address: lead.address
            },
            audit: prunedAudit
          })
        });

        const enrichData = await enrichRes.json();

        if (!enrichRes.ok) {
          throw new Error(enrichData.error || enrichData.details || 'Enrichment failed');
        }

        const rawEnrichment = enrichData.enrichment || enrichData;
        const transformedEnrichment = {
          ...rawEnrichment,
          riskFactors: [
            ...(rawEnrichment.criticalIssues || []),
            ...(rawEnrichment.weaknesses || [])
          ].slice(0, 5),
          valueGaps: rawEnrichment.quickWins ? rawEnrichment.quickWins.slice(0, 4) : [],
          salesHooks: rawEnrichment.suggestedCopyEdits || [],
          recommendedServices: deriveRecommendedServices(rawEnrichment.quickWins || []),
          competitivePosition: deriveCompetitivePosition(rawEnrichment.strengths || []),
          priority: rawEnrichment.criticalIssues?.length ? 'high' : 
                   rawEnrichment.weaknesses?.length ? 'medium' : 'low'
        };

        onUpdateLead(lead.id, {
          status: 'enriched',
          enrichment: transformedEnrichment
        });
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err ?? 'Unknown error');
        console.error('Enrichment error:', err);
        
        const fallbackEnrichment = {
          summary: lead.audit?.overallScore 
            ? `Audit complete with score ${lead.audit.overallScore}/100. AI enrichment pending.` 
            : 'Enrichment temporarily unavailable.',
          strengths: [],
          weaknesses: [],
          criticalIssues: [],
          quickWins: [],
          suggestedCopyEdits: [],
          designScore: 50,
          uxScore: 50,
          conversionScore: 50,
          trustScore: 50,
          overallScore: lead.audit?.overallScore ?? 50,
          timestamp: Date.now(),
          riskFactors: ['AI enrichment unavailable — retry or check API status'],
          valueGaps: [],
          salesHooks: [],
          recommendedServices: ['Technical Audit', 'Performance Optimization'],
          competitivePosition: 'Pending AI analysis.',
          priority: 'medium' as const
        };
        
        onUpdateLead(lead.id, { 
          status: 'enriched', 
          enrichment: fallbackEnrichment 
        });
        alert(`Enrichment failed, using fallback data: ${error}`);
      }
    }
  };

  return (
    <div className="glass overflow-hidden rounded-2xl border border-white/5">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02]">
              <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Business</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Maps Rating</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Audit Status</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Health Score</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Enrichment</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <Globe className="w-8 h-8 opacity-20" />
                    <p>No leads found. Import some to get started.</p>
                  </div>
                </td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr key={lead.id} className="group hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <div
                          className="flex items-center gap-2 cursor-pointer"
                          onClick={() => onSelectLead?.(lead)}
                        >
                          <span className="font-bold text-slate-100 group-hover:text-brand-primary transition-all duration-300">
                            {lead.name}
                          </span>
                        </div>
                        {lead.website && (
                          <div className="flex items-center gap-1">
                            <div className="w-1 h-1 rounded-full bg-slate-700" />
                            <a
                              href={lead.website}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-primary/5 hover:bg-brand-primary/10 text-brand-primary text-[10px] font-bold uppercase tracking-wider rounded-md border border-brand-primary/10 hover:border-brand-primary/30 transition-all group/link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Globe className="w-3 h-3" />
                              Website
                              <ExternalLink className="w-2.5 h-2.5 opacity-50 group-hover/link:opacity-100" />
                            </a>
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-1 font-medium">
                        <MapPin className="w-3 h-3 text-slate-600" />
                        <span className="truncate max-w-[200px]">
                          {lead.address || lead.category || 'No address provided'}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span className="text-sm font-medium text-slate-200">{lead.rating}</span>
                      <span className="text-xs text-slate-500">({lead.reviews})</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={lead.status} />
                  </td>
                  <td className="px-6 py-4">
                    {lead.audit ? (
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${getScoreColor(lead.audit.overallScore)}`}
                            style={{ width: `${lead.audit.overallScore}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-300">{lead.audit.overallScore}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {lead.enrichment ? (
                      <div className="flex items-center gap-1 text-emerald-400">
                        <Zap className="w-3.5 h-3.5 fill-emerald-400" />
                        <span className="text-xs font-medium">Ready</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">Pending</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => onDeleteLead?.(lead.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        title="Delete lead"
                      >
                        <Cross className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleAction(lead)}
                        disabled={lead.status === 'auditing' || lead.status === 'enriching'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {lead.status === 'new' ? 'Run Audit' :
                          lead.status === 'audited' ? 'Generate Enrichment' :
                            lead.status === 'enriched' ? (
                              <>View Details</>
                            ) :
                              'Processing...'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'enriched':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
          <CheckCircle2 className="w-3 h-3" /> Enriched
        </span>
      );
    case 'audited':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-400/10 text-blue-400 border border-blue-400/20">
          <Globe className="w-3 h-3" /> Audited
        </span>
      );
    case 'auditing':
    case 'enriching':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-400/10 text-amber-400 border border-amber-400/20 animate-pulse">
          <Clock className="w-3 h-3" /> Processing
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-400/10 text-slate-400 border border-slate-400/20">
          New
        </span>
      );
  }
}

function getScoreColor(score: number) {
  if (score >= 90) return 'bg-emerald-500';
  if (score >= 70) return 'bg-blue-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

function Cross({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function deriveRecommendedServices(quickWins: string[]): string[] {
  const services: string[] = [];
  const lowerWins = quickWins.join(' ').toLowerCase();
  
  if (lowerWins.includes('seo') || lowerWins.includes('meta') || lowerWins.includes('title')) {
    services.push('SEO Optimization');
  }
  if (lowerWins.includes('speed') || lowerWins.includes('lcp') || lowerWins.includes('loading')) {
    services.push('Page Speed Optimization');
  }
  if (lowerWins.includes('mobile') || lowerWins.includes('responsive') || lowerWins.includes('cta')) {
    services.push('Mobile CRO');
  }
  if (lowerWins.includes('content') || lowerWins.includes('copy') || lowerWins.includes('headline')) {
    services.push('Content Strategy');
  }
  if (lowerWins.includes('trust') || lowerWins.includes('review') || lowerWins.includes('testimonial')) {
    services.push('Trust Signal Implementation');
  }
  if (lowerWins.includes('link') || lowerWins.includes('broken')) {
    services.push('Technical SEO Audit');
  }
  if (services.length === 0 && quickWins.length > 0) {
    services.push('Website Redesign', 'Performance Audit', 'Conversion Optimization');
  }
  
  return services.slice(0, 4);
}

function deriveCompetitivePosition(strengths: string[]): string {
  if (strengths.length === 0) return 'Position unclear — needs analysis.';
  
  const strongPoints = strengths.slice(0, 2).join(' ').toLowerCase();
  if (strongPoints.includes('fast') || strongPoints.includes('performance')) {
    return 'Site loads quickly, giving advantage over slower competitors.';
  }
  if (strongPoints.includes('mobile') || strongPoints.includes('responsive')) {
    return 'Mobile experience is solid — can leverage this against non-mobile competitors.';
  }
  if (strongPoints.includes('seo') || strongPoints.includes('content')) {
    return 'Content quality helps with search visibility — opportunity to outrank competitors.';
  }
  return 'Site has notable strengths but significant gaps remain to compete effectively.';
}
