import path from 'node:path';

export type PaperSessionAsset = 'BTC' | 'ETH';

export type PaperSessionPositionSide = 'flat' | 'long' | 'short';

export type PaperSessionPredictionSide = 'up' | 'down';

export interface PaperSessionPosition {
  asset?: PaperSessionAsset;
  side: PaperSessionPositionSide;
  predictionSide?: PaperSessionPredictionSide | null;
  size: number;
  shares?: number;
  stake?: number;
  entryPrice: number | null;
  entryFee?: number;
  marketSlug?: string;
  openedAt?: string;
  bucketStartTime?: string;
  endDate?: string | null;
}

export interface PaperSessionHistoryPoint {
  timestamp: string;
  price: number;
}

export interface PaperSessionRollingHistory {
  points: PaperSessionHistoryPoint[];
  maxLength: number;
}

export interface PaperSessionHistoryMap {
  BTC: PaperSessionRollingHistory;
  ETH: PaperSessionRollingHistory;
}

export interface PaperSessionState {
  sessionName: string;
  sessionSlug: string;
  createdAt: string;
  updatedAt: string;
  cash: number;
  equity: number;
  positions: Partial<Record<PaperSessionAsset, PaperSessionPosition>>;
  tradeCount: number;
  cycleCount: number;
  history: PaperSessionHistoryMap;
}

export interface PaperSessionSummary {
  sessionName: string;
  sessionSlug: string;
  createdAt: string;
  updatedAt: string;
  cash: number;
  equity: number;
  tradeCount: number;
  cycleCount: number;
}

export interface PaperSessionPaths {
  rootDir: string;
  sessionName: string;
  sessionSlug: string;
  sessionDirName: string;
  statePath: string;
  summaryPath: string;
  eventsPath: string;
}

export interface PaperSessionEvent {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export const PAPER_SESSION_HISTORY_LIMIT = 200;
export const PAPER_SESSION_STARTING_CASH = 1000;
export const PAPER_SYNTHETIC_CANDLE_VOLUME = 1000;

export function normalizePaperSessionSlug(sessionName: string): string {
  const slug = sessionName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'session';
}

export function buildPaperSessionDirectoryName(sessionName: string): string {
  const trimmedName = sessionName.trim();
  return encodeURIComponent(trimmedName.length > 0 ? trimmedName : 'session');
}

export function resolvePaperSessionPaths(cwd = process.cwd(), sessionName: string): PaperSessionPaths {
  const sessionSlug = normalizePaperSessionSlug(sessionName);
  const sessionDirName = buildPaperSessionDirectoryName(sessionName);
  const rootDir = path.resolve(cwd, 'botlab/paper-sessions', sessionDirName);

  return {
    rootDir,
    sessionName,
    sessionSlug,
    sessionDirName,
    statePath: path.resolve(rootDir, 'state.json'),
    summaryPath: path.resolve(rootDir, 'summary.json'),
    eventsPath: path.resolve(rootDir, 'events.jsonl'),
  };
}
