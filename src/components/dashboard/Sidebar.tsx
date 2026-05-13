"use client";

import React from 'react';
import { 
  LayoutDashboard, 
  LogOut,
  Zap
} from 'lucide-react';

const navItems = [
  { icon: LayoutDashboard, label: 'Overview', active: true },
];

export default function Sidebar() {
  return (
    <aside className="w-64 border-r border-white/5 bg-black/20 backdrop-blur-xl flex flex-col p-6 h-screen sticky top-0">
      <div className="flex items-center gap-3 mb-12">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-primary to-brand-secondary flex items-center justify-center shadow-lg shadow-brand-primary/20">
          <Zap className="text-white w-6 h-6 fill-white/20" />
        </div>
        <h1 className="text-xl font-display font-bold tracking-tight text-white">
          Lead<span className="text-brand-primary">Intel</span>
        </h1>
      </div>

      <nav className="flex-1 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
              item.active 
                ? 'bg-brand-primary/10 text-brand-primary border border-brand-primary/20 shadow-lg shadow-brand-primary/5' 
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <item.icon className={`w-5 h-5 ${item.active ? 'text-brand-primary' : 'group-hover:text-white'}`} />
            <span className="font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto pt-6 border-t border-white/5">
        <button className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all">
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </aside>
  );
}
