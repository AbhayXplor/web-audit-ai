export type LeadStatus = 'new' | 'auditing' | 'audited' | 'enriching' | 'enriched' | 'failed';

export interface CoreWebVitals {
  lcp: number; // Largest Contentful Paint in ms
  cls: number; // Cumulative Layout Shift
  inp: number; // Interaction to Next Paint in ms
  fcp: number; // First Contentful Paint in ms
  ttfb: number; // Time to First Byte in ms
}

export interface SEOChecks {
  title: { present: boolean; length?: number; value?: string };
  metaDescription: { present: boolean; length?: number; value?: string };
  h1: { present: boolean; count: number };
  canonical: { present: boolean; value?: string };
  openGraph: { present: boolean };
  structuredData: { present: boolean; type?: string; errors: string[] };
  robotsTxt: { present: boolean; content?: string };
  sitemap: { present: boolean; url?: string };
  duplicateTitle: boolean;
  duplicateDescription: boolean;
  thinContent: boolean;
}

export interface AccessibilityChecks {
  score: number;
  violations: Array<{
    id: string;
    impact: 'critical' | 'serious' | 'moderate' | 'minor';
    description: string;
  }>;
  langAttribute: boolean;
  viewportMeta: boolean;
  altImages: number; // count of images with alt
  ariaLabels: number; // count of proper ARIA labels
}

export interface SecurityHeaders {
  hsts: { present: boolean; maxAge?: number };
  csp: { present: boolean; value?: string };
  xFrameOptions: { present: boolean; value?: string };
  xContentTypeOptions: { present: boolean };
  referrerPolicy: { present: boolean; value?: string };
  permissionsPolicy: { present: boolean; value?: string };
}

export interface LinkAnalysis {
  totalInternal: number;
  totalExternal: number;
  brokenInternal: number;
  brokenExternal: number;
  redirectChains: Array<{ from: string; to: string; hops: number }>;
  orphanPages: string[];
}

export interface DesignScore {
  overall: number; // 0-100
  typography: number;
  color: number;
  spacing: number;
  layout: number;
  interaction: number;
  consistency: number;
  polish: number;
}

export interface AuditData {
  // Overall scores (0-100)
  performanceScore: number;
  seoScore: number;
  accessibilityScore: number;
  securityScore: number;
  designScore: number;
  overallScore: number;

  // Letter grades (auto-calculated)
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  performanceGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  seoGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  accessibilityGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  securityGrade: 'A' | 'B' | 'C' | 'D' | 'F';

  // Recommendation flags (unbiased, threshold-based)
  recommendations: {
    downloadReport: boolean;  // Score low enough to warrant full audit report
    priority: 'low' | 'medium' | 'high' | 'critical';
    suggestedServices: string[];
    estimatedEffort: 'low' | 'medium' | 'high';
    expectedImpact: 'low' | 'medium' | 'high';
  };

  // ... rest unchanged

  // Core Web Vitals
  webVitals: {
    desktop: CoreWebVitals;
    mobile: CoreWebVitals;
  };

  // Detailed checks
  seo: SEOChecks;
  accessibility: AccessibilityChecks;
  security: SecurityHeaders;
  links: LinkAnalysis;
  design: DesignScore;

  // Screenshots (base64)
  screenshotDesktop?: string;
  screenshotMobile?: string;

  // Crawl metadata
  pagesCrawled: number;
  crawlDuration: number; // seconds
  timestamp: number;

  // Red flags (auto-detected urgent issues)
  redFlags: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: 'performance' | 'seo' | 'security' | 'accessibility' | 'links';
    message: string;
    impact: string;
    affectedUrls?: string[];
  }>;

  // Raw data for AI enrichment
  raw?: any;
}

export interface Lead {
  id: string;
  name: string;
  website: string;
  phone?: string;
  address?: string;
  rating?: number;
  reviews?: number;
  category?: string;
  status: LeadStatus;
  
  // Technical Audit Data
  audit?: AuditData;

  // AI Enrichment Data
  enrichment?: {
    valueGaps: string[];
    salesHooks: string[];
    riskFactors: string[];
    summary: string;
    priority: 'low' | 'medium' | 'high';
    competitivePosition?: string;
    recommendedServices?: string[];
    timestamp: number;
  };

  // Computed fields (not stored, calculated on render)
  _gradeColor?: 'emerald' | 'blue' | 'amber' | 'rose' | 'slate';
}

export interface DashboardStats {
  totalLeads: number;
  pendingAudits: number;
  priorityLeads: number;
  avgTechScore: number;
  avgPerformance: number;
  avgSEO: number;
  criticalIssues: number;
}
