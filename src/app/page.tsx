"use client";

import React, { useState, useRef } from 'react';
import Sidebar from '@/components/dashboard/Sidebar';
import Stats from '@/components/dashboard/Stats';
import LeadTable from '@/components/dashboard/LeadTable';
import LeadDetailDrawer from '@/components/dashboard/LeadDetailDrawer';
import { useLeads } from '@/hooks/useLeads';
import { Upload, Search, Plus, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Lead } from '@/types';

export default function Dashboard() {
  const { leads, addLeads, updateLead, deleteLead, clearLeads } = useLeads();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manualForm, setManualForm] = useState({
    name: '', website: '', rating: 5, reviews: 0, category: '', phone: '', address: ''
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.leads && Array.isArray(data.leads)) {
        addLeads(data.leads);
      } else if (data.error) {
        console.error("Upload error:", data.error);
        alert(`Upload failed: ${data.error}`);
      }
    } catch (error) {
      console.error("Upload failed", error);
      alert("An error occurred during file upload.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteAll = () => {
    if (confirm('Delete all leads? This cannot be undone.')) {
      clearLeads();
    }
  };

  const handleDeleteSingle = (id: string) => {
    if (confirm('Delete this lead?')) {
      deleteLead(id);
    }
  };

  const handleManualAdd = () => {
    if (!manualForm.name || !manualForm.website) {
      alert('Name and Website are required');
      return;
    }
    const newLead: Lead = {
      id: uuidv4(),
      name: manualForm.name,
      website: manualForm.website.startsWith('http') ? manualForm.website : `https://${manualForm.website}`,
      phone: manualForm.phone,
      rating: Number(manualForm.rating) || 5,
      reviews: Number(manualForm.reviews) || 0,
      category: manualForm.category || 'Unknown',
      address: manualForm.address || undefined,
      status: 'new' as const,
    };
    addLeads([newLead]);
    setManualForm({ name: '', website: '', rating: 5, reviews: 0, category: '', phone: '', address: '' });
    setShowManualForm(false);
  };

  const filteredLeads = leads.filter(lead => 
    lead.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (lead.website && lead.website.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
      <Sidebar />
      
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h2 className="text-3xl font-display font-bold text-white mb-1">Intelligence Dashboard</h2>
            <p className="text-slate-400">Manage and enrich your local business leads.</p>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowManualForm(!showManualForm)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-brand-primary/10 text-slate-300 hover:text-brand-primary border border-white/5 hover:border-brand-primary/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              Add Manually
            </button>
            <button 
              onClick={handleDeleteAll}
              disabled={leads.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-rose-500/10 text-slate-300 hover:text-rose-400 border border-white/5 hover:border-rose-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              Clear All
            </button>
            <input 
              type="file" 
              accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="w-4 h-4" />
              {isUploading ? 'Uploading...' : 'Upload Excel'}
            </button>
          </div>
        </div>

        <Stats leads={leads} onDeleteAll={handleDeleteAll} />

        {/* Manual Add Form (collapsed by default) */}
        {showManualForm && (
          <div className="glass-card p-6 mb-8 border-brand-primary/20">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Add Lead Manually</h3>
              <button onClick={() => setShowManualForm(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <input
                type="text"
                placeholder="Business Name *"
                value={manualForm.name}
                onChange={e => setManualForm({...manualForm, name: e.target.value})}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
              <input
                type="text"
                placeholder="Website URL *"
                value={manualForm.website}
                onChange={e => setManualForm({...manualForm, website: e.target.value})}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
              <input
                type="text"
                placeholder="Category"
                value={manualForm.category}
                onChange={e => setManualForm({...manualForm, category: e.target.value})}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
              <input
                type="number"
                placeholder="Rating (0-5)"
                value={manualForm.rating}
                onChange={e => setManualForm({...manualForm, rating: e.target.value === '' ? 0 : Number(e.target.value)})}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
              <input
                type="number"
                placeholder="Review Count"
                value={manualForm.reviews}
                onChange={e => setManualForm({...manualForm, reviews: e.target.value === '' ? 0 : Number(e.target.value)})}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
              <input
                type="text"
                placeholder="Phone"
                value={manualForm.phone}
                onChange={e => setManualForm({...manualForm, phone: e.target.value})}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
              <input
                type="text"
                placeholder="Address"
                value={manualForm.address}
                onChange={e => setManualForm({...manualForm, address: e.target.value})}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white col-span-2"
              />
            </div>
            <button
              onClick={handleManualAdd}
              className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-brand-primary/90"
            >
              Add Lead
            </button>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search business or website..." 
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-3">
            <p className="text-xs text-slate-500 font-medium">Showing {filteredLeads.length} leads</p>
          </div>
        </div>

        <LeadTable 
          leads={filteredLeads} 
          onUpdateLead={updateLead} 
          onSelectLead={setSelectedLead}
          onDeleteLead={handleDeleteSingle}
        />
      </main>

      <LeadDetailDrawer 
        lead={selectedLead} 
        isOpen={!!selectedLead} 
        onClose={() => setSelectedLead(null)} 
      />
    </div>
  );
}
