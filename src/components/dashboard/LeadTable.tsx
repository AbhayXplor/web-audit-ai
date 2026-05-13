"use client";

import React, { useState } from 'react';
import { MoreHorizontal, Globe, Star, MapPin, CheckCircle2, Clock, Zap, ExternalLink, MousePointer2 } from 'lucide-react';
import { Lead } from '../../types';

interface LeadTableProps {
  leads: Lead[];
  onUpdateLead?: (id: string, updates: Partial<Lead>) => void;
  onSelectLead?: (lead: Lead) => void;
  onDeleteLead?: (id: string) => void;
}

export default function LeadTable({ leads, onUpdateLead, onSelectLead, onDeleteLead }: LeadTableProps) {

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
            depth: 3,
            maxPages: 30
          })
        });

        const responseData = await auditRes.json();

        if (!auditRes.ok) {
          throw new Error(responseData.error || 'Audit failed');
        }

        onUpdateLead(lead.id, {
          status: 'audited',
          audit: responseData.audit
        });
      } catch (err: any) {
        console.error('Audit error:', err);
        alert(`Audit failed: ${err.message}`);
        onUpdateLead(lead.id, { status: 'new' });
      }
    } else if (lead.status === 'audited' || !lead.enrichment) {
      // Run Enrich
      try {
        // Try enrichment without screenshots first to avoid payload issues
        onUpdateLead(lead.id, { status: 'enriching' });

        // Prune audit data to avoid payload limits - remove heavy screenshot data
        const prunedAudit = lead.audit ? JSON.parse(JSON.stringify(lead.audit)) : null;
        if (prunedAudit) {
          delete prunedAudit.raw;
          // Remove screenshots for enrichment (they're large, and text analysis is enough)
          delete prunedAudit.screenshotDesktop;
          delete prunedAudit.screenshotMobile;
          // Slice large arrays just in case
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

        onUpdateLead(lead.id, {
          status: 'enriched',
          enrichment: enrichData.enrichment || enrichData
        });
      } catch (err: any) {
        console.error('Enrichment error:', err);
        alert(`Enrichment failed: ${err.message}. The lead is already audited - you can try again.`);
        onUpdateLead(lead.id, { status: 'audited' });
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
                          className="flex items-center gap-2 cursor-pointer group/name"
                          onClick={() => onSelectLead?.(lead)}
                        >
                          <span className="font-bold text-slate-100 group-hover/name:text-brand-primary transition-all duration-300">
                            {lead.name}
                          </span>
                          <MousePointer2 className="w-3 h-3 text-brand-primary opacity-0 group-hover/name:opacity-100 group-hover/name:translate-x-1 transition-all" />
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
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
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
