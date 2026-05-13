"use client";

import { useState, useEffect, useCallback } from 'react';
import { Lead, LeadStatus } from '../types';

const STORAGE_KEY = 'enrichment_leads';

export function useLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  // Load from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setLeads(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse leads from storage", e);
      }
    }
    setLoading(false);
  }, []);

  // Save to localStorage
  const saveLeads = useCallback((newLeads: Lead[]) => {
    setLeads(newLeads);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newLeads));
  }, []);

  const addLeads = (newLeads: Lead[]) => {
    const existingIds = new Set(leads.map(l => l.id));
    const uniqueNewLeads = newLeads.filter(l => !existingIds.has(l.id));
    saveLeads([...leads, ...uniqueNewLeads]);
  };

  const updateLead = (id: string, updates: Partial<Lead>) => {
    const updated = leads.map(l => l.id === id ? { ...l, ...updates } : l);
    saveLeads(updated);
  };

  const deleteLead = (id: string) => {
    saveLeads(leads.filter(l => l.id !== id));
  };

  const clearLeads = () => {
    saveLeads([]);
  };

  return {
    leads,
    loading,
    addLeads,
    updateLead,
    deleteLead,
    clearLeads
  };
}
