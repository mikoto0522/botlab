import path from 'node:path';
import type {
  PaperSessionAsset,
  PaperSessionEvent,
  PaperSessionHistoryMap,
  PaperSessionPosition,
  PaperSessionSummary,
  PaperSessionState,
} from '../paper/types.js';
import {
  buildPaperSessionDirectoryName,
  normalizePaperSessionSlug,
  PAPER_SESSION_HISTORY_LIMIT,
  PAPER_SESSION_STARTING_CASH,
  PAPER_SYNTHETIC_CANDLE_VOLUME,
} from '../paper/types.js';

export type LiveSessionAsset = PaperSessionAsset;
export type LiveSessionPosition = PaperSessionPosition;
export type LiveSessionHistoryMap = PaperSessionHistoryMap;
export type LiveSessionState = PaperSessionState;
export type LiveSessionSummary = PaperSessionSummary;
export type LiveSessionEvent = PaperSessionEvent;

export interface LiveSessionPaths {
  rootDir: string;
  sessionName: string;
  sessionSlug: string;
  sessionDirName: string;
  statePath: string;
  summaryPath: string;
  eventsPath: string;
}

export const LIVE_SESSION_HISTORY_LIMIT = PAPER_SESSION_HISTORY_LIMIT;
export const LIVE_SESSION_STARTING_CASH = PAPER_SESSION_STARTING_CASH;
export const LIVE_SYNTHETIC_CANDLE_VOLUME = PAPER_SYNTHETIC_CANDLE_VOLUME;

export function resolveLiveSessionPaths(cwd = process.cwd(), sessionName: string): LiveSessionPaths {
  const sessionSlug = normalizePaperSessionSlug(sessionName);
  const sessionDirName = buildPaperSessionDirectoryName(sessionName);
  const rootDir = path.resolve(cwd, 'botlab/live-sessions', sessionDirName);

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
