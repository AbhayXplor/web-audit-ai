import { AuditMode, AuditModeConfig } from '../types';

export const AUDIT_MODES: Record<AuditMode, AuditModeConfig> = {
  fast: {
    maxPages: 3,
    depth: 1,
    lighthouseSamples: 0,
    screenshotWait: 0,
    brokenLinksMax: 10,
    loadWaitUntil: 'domcontentloaded'
  },
  balanced: {
    maxPages: 10,
    depth: 2,
    lighthouseSamples: 1,
    screenshotWait: 1,
    brokenLinksMax: 30,
    loadWaitUntil: 'networkidle'
  },
  deep: {
    maxPages: 30,
    depth: 3,
    lighthouseSamples: 5,
    screenshotWait: 3,
    brokenLinksMax: 50,
    loadWaitUntil: 'networkidle'
  }
};
