"use client";

import React, { useMemo } from 'react';
import { Users, Zap, AlertCircle, BarChart, Trash2 } from 'lucide-react';
import { Lead } from '@/types';

interface StatsProps {
  leads: Lead[];
  onDeleteAll?: () => void;
}

export default function Stats({ leads, onDeleteAll }: StatsProps) {
  const stats = useMemo(() => {
    const totalLeads = leads.length;
    
    // High priority: enriched + has red flags OR critical red flags present
    const highPriority = leads.filter(l => 
      l.status === 'enriched' && 
      l.audit?.redFlags?.some((f: any) => f.severity === 'critical' || f.severity === 'high')
    ).length;

    const pendingAudits = leads.filter(l => 
      l.status === 'new' || l.status === 'auditing'
    ).length;

    // Calculate average overall tech score
    const auditedLeads = leads.filter(l => l.audit);
    let avgScore = 0;
    if (auditedLeads.length > 0) {
      const sum = auditedLeads.reduce((acc, l) => {
        return acc + (l.audit?.overallScore || 0);
      }, 0);
      avgScore = Math.round(sum / auditedLeads.length);
    }

    return [
      { label: 'Total Leads', value: String(totalLeads), icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10' },
      { label: 'High Priority', value: String(highPriority), icon: Zap, color: 'text-amber-400', bg: 'bg-amber-400/10' },
      { label: 'Pending Audits', value: String(pendingAudits), icon: AlertCircle, color: 'text-rose-400', bg: 'bg-rose-400/10' },
      { label: 'Avg Health Score', value: auditedLeads.length > 0 ? `${avgScore}%` : 'N/A', icon: BarChart, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    ];
  }, [leads]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {stats.map((stat) => (
        <div key={stat.label} className="glass-card flex items-center gap-4">
          <div className={`p-3 rounded-xl ${stat.bg}`}>
            <stat.icon className={`w-6 h-6 ${stat.color}`} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-400">{stat.label}</p>
            <p className="text-2xl font-display font-bold text-white">{stat.value}</p>
          </div>
          {stat.label === 'Total Leads' && onDeleteAll && leads.length > 0 && (
            <button
              onClick={onDeleteAll}
              title="Delete all leads"
              className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
