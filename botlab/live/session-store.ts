import fs from 'node:fs';
import type {
  LiveSessionAsset,
  LiveSessionEvent,
  LiveSessionHistoryMap,
  LiveSessionPaths,
  LiveSessionState,
  LiveSessionSummary,
  LiveSessionPosition,
} from './types.js';
import {
  LIVE_SESSION_HISTORY_LIMIT,
  LIVE_SESSION_STARTING_CASH,
  resolveLiveSessionPaths,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readOptionalString(
  value: unknown,
  sessionName: string,
  statePath: string,
  fieldPath: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isString(value)) {
    throw createSessionLoadError(sessionName, statePath, `${fieldPath} must be a non-empty string when provided`);
  }

  return value;
}

function readOptionalNullableString(
  value: unknown,
  sessionName: string,
  statePath: string,
  fieldPath: string,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  if (!isString(value)) {
    throw createSessionLoadError(sessionName, statePath, `${fieldPath} must be a non-empty string, null, or undefined`);
  }

  return value;
}

function createSessionLoadError(sessionName: string, statePath: string, reason: string): Error {
  return new Error(`Failed to load live session "${sessionName}" from ${statePath}: ${reason}`);
}

function createEmptyHistory() {
  return {
    maxLength: LIVE_SESSION_HISTORY_LIMIT,
    points: [],
  };
}

function createDefaultHistoryMap(): LiveSessionHistoryMap {
  return {
    BTC: createEmptyHistory(),
    ETH: createEmptyHistory(),
  };
}

function inferPredictionSide(side: LiveSessionPosition['side']): LiveSessionPosition['predictionSide'] {
  if (side === 'long') {
    return 'up';
  }
  if (side === 'short') {
    return 'down';
  }

  return null;
}

function readPosition(value: unknown, sessionName: string, statePath: string, asset: string): LiveSessionPosition {
  if (!isRecord(value)) {
    throw createSessionLoadError(sessionName, statePath, `positions.${asset} must be an object`);
  }

  if (value.side !== 'flat' && value.side !== 'long' && value.side !== 'short') {
    throw createSessionLoadError(sessionName, statePath, `positions.${asset}.side must be flat, long, or short`);
  }
  if (!isFiniteNumber(value.size)) {
    throw createSessionLoadError(sessionName, statePath, `positions.${asset}.size must be a finite number`);
  }
  if (!(value.entryPrice === null || isFiniteNumber(value.entryPrice))) {
    throw createSessionLoadError(sessionName, statePath, `positions.${asset}.entryPrice must be a finite number or null`);
  }
  if (!(value.asset === undefined || value.asset === 'BTC' || value.asset === 'ETH')) {
    throw createSessionLoadError(sessionName, statePath, `positions.${asset}.asset must be BTC or ETH when provided`);
  }
  if (!(value.predictionSide === undefined || value.predictionSide === null || value.predictionSide === 'up' || value.predictionSide === 'down')) {
    throw createSessionLoadError(sessionName, statePath, `positions.${asset}.predictionSide must be up, down, null, or undefined`);
  }
  if (!(value.shares === undefined || isFiniteNumber(value.shares))) {
    throw createSessionLoadError(sessionName, statePath, `positions.${asset}.shares must be a finite number when provided`);
  }
  if (!(value.stake === undefined || isFiniteNumber(value.stake))) {
    throw createSessionLoadError(sessionName, statePath, `positions.${asset}.stake must be a finite number when provided`);
  }
  if (!(value.entryFee === undefined || isFiniteNumber(value.entryFee))) {
    throw createSessionLoadError(sessionName, statePath, `positions.${asset}.entryFee must be a finite number when provided`);
  }

  return {
    asset: (value.asset as LiveSessionAsset | undefined) ?? (asset as LiveSessionAsset),
    side: value.side,
    predictionSide: (value.predictionSide as LiveSessionPosition['predictionSide'] | undefined) ?? inferPredictionSide(value.side as LiveSessionPosition['side']),
    size: value.size,
    shares: (value.shares as number | undefined) ?? value.size,
    stake: value.stake as number | undefined,
    entryPrice: value.entryPrice as number | null,
    entryFee: (value.entryFee as number | undefined) ?? 0,
    marketSlug: readOptionalString(value.marketSlug, sessionName, statePath, `positions.${asset}.marketSlug`),
    openedAt: readOptionalString(value.openedAt, sessionName, statePath, `positions.${asset}.openedAt`),
    bucketStartTime: readOptionalString(value.bucketStartTime, sessionName, statePath, `positions.${asset}.bucketStartTime`),
    endDate: readOptionalNullableString(value.endDate, sessionName, statePath, `positions.${asset}.endDate`),
  };
}

function readHistory(value: unknown, sessionName: string, statePath: string, asset: string) {
  if (!isRecord(value)) {
    throw createSessionLoadError(sessionName, statePath, `history.${asset} must be an object`);
  }

  if (!isFiniteNumber(value.maxLength) || value.maxLength <= 0) {
    throw createSessionLoadError(sessionName, statePath, `history.${asset}.maxLength must be a positive number`);
  }
  if (!Array.isArray(value.points)) {
    throw createSessionLoadError(sessionName, statePath, `history.${asset}.points must be an array`);
  }

  const maxLength = Math.floor(value.maxLength);
  const points = value.points.map((point, index) => {
    if (!isRecord(point)) {
      throw createSessionLoadError(sessionName, statePath, `history.${asset}.points[${index}] must be an object`);
    }
    if (!isString(point.timestamp)) {
      throw createSessionLoadError(sessionName, statePath, `history.${asset}.points[${index}].timestamp must be a string`);
    }
    if (!isFiniteNumber(point.price)) {
      throw createSessionLoadError(sessionName, statePath, `history.${asset}.points[${index}].price must be a finite number`);
    }

    return {
      timestamp: point.timestamp,
      price: point.price,
    };
  });

  return {
    maxLength,
    points: points.slice(-maxLength),
  };
}

function readHistoryMap(value: unknown, sessionName: string, statePath: string): LiveSessionHistoryMap {
  if (!isRecord(value)) {
    throw createSessionLoadError(sessionName, statePath, 'history must be an object');
  }

  return {
    BTC: readHistory(value.BTC, sessionName, statePath, 'BTC'),
    ETH: readHistory(value.ETH, sessionName, statePath, 'ETH'),
  };
}

function normalizeState(raw: unknown, sessionName: string, sessionSlug: string, statePath: string): LiveSessionState {
  if (!isRecord(raw)) {
    throw createSessionLoadError(sessionName, statePath, 'state file must be a JSON object');
  }

  if (!isString(raw.sessionName)) {
    throw createSessionLoadError(sessionName, statePath, 'sessionName must be a non-empty string');
  }
  if (!isString(raw.createdAt)) {
    throw createSessionLoadError(sessionName, statePath, 'createdAt must be a non-empty string');
  }
  if (!isString(raw.updatedAt)) {
    throw createSessionLoadError(sessionName, statePath, 'updatedAt must be a non-empty string');
  }
  if (!isFiniteNumber(raw.cash)) {
    throw createSessionLoadError(sessionName, statePath, 'cash must be a finite number');
  }
  if (!isFiniteNumber(raw.equity)) {
    throw createSessionLoadError(sessionName, statePath, 'equity must be a finite number');
  }
  if (!isRecord(raw.positions)) {
    throw createSessionLoadError(sessionName, statePath, 'positions must be an object');
  }
  if (!isFiniteNumber(raw.tradeCount)) {
    throw createSessionLoadError(sessionName, statePath, 'tradeCount must be a finite number');
  }
  if (!isFiniteNumber(raw.cycleCount)) {
    throw createSessionLoadError(sessionName, statePath, 'cycleCount must be a finite number');
  }

  const positions: Partial<Record<'BTC' | 'ETH', LiveSessionPosition>> = {};
  for (const [asset, position] of Object.entries(raw.positions)) {
    if (asset === 'BTC' || asset === 'ETH') {
      positions[asset] = readPosition(position, sessionName, statePath, asset);
    }
  }

  return {
    sessionName: raw.sessionName,
    sessionSlug,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    cash: raw.cash,
    equity: raw.equity,
    positions,
    tradeCount: raw.tradeCount,
    cycleCount: raw.cycleCount,
    history: readHistoryMap(raw.history, sessionName, statePath),
  };
}

function toSummary(state: LiveSessionState): LiveSessionSummary {
  return {
    sessionName: state.sessionName,
    sessionSlug: state.sessionSlug,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    cash: state.cash,
    equity: state.equity,
    tradeCount: state.tradeCount,
    cycleCount: state.cycleCount,
  };
}

function shouldPersistLiveSessionEvent(event: LiveSessionEvent): boolean {
  if (event.type === 'live-strategy-decision') {
    return event.action !== 'hold' && event.action !== 'flat';
  }

  if (event.type === 'live-cycle-complete') {
    const openedCount = typeof event.openedCount === 'number' ? event.openedCount : 0;
    const closedCount = typeof event.closedCount === 'number' ? event.closedCount : 0;
    const settledCount = typeof event.settledCount === 'number' ? event.settledCount : 0;
    return openedCount > 0 || closedCount > 0 || settledCount > 0;
  }

  return true;
}

export function createEmptyLiveSessionState(
  sessionName: string,
  options: { startingCash?: number; now?: string } = {},
): LiveSessionState {
  const now = options.now ?? new Date().toISOString();
  const startingCash = isFiniteNumber(options.startingCash) ? options.startingCash : LIVE_SESSION_STARTING_CASH;
  const { sessionSlug } = resolveLiveSessionPaths(process.cwd(), sessionName);

  return {
    sessionName,
    sessionSlug,
    createdAt: now,
    updatedAt: now,
    cash: startingCash,
    equity: startingCash,
    positions: {},
    tradeCount: 0,
    cycleCount: 0,
    history: createDefaultHistoryMap(),
  };
}

export function loadLiveSessionState(
  sessionName: string,
  cwd = process.cwd(),
  options: { startingCash?: number } = {},
): LiveSessionState {
  const paths = resolveLiveSessionPaths(cwd, sessionName);

  if (!fs.existsSync(paths.statePath)) {
    return createEmptyLiveSessionState(sessionName, { startingCash: options.startingCash });
  }

  let parsed: unknown;
  try {
    const raw = fs.readFileSync(paths.statePath, 'utf-8');
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw createSessionLoadError(sessionName, paths.statePath, 'state file is not valid JSON');
  }

  return normalizeState(parsed, paths.sessionName, paths.sessionSlug, paths.statePath);
}

export function saveLiveSessionState(state: LiveSessionState, cwd = process.cwd()): LiveSessionPaths {
  const paths = resolveLiveSessionPaths(cwd, state.sessionName);
  const normalizedState = normalizeState(state, state.sessionName, paths.sessionSlug, paths.statePath);
  const updatedAt = new Date().toISOString();

  normalizedState.sessionName = state.sessionName;
  normalizedState.sessionSlug = paths.sessionSlug;
  normalizedState.updatedAt = updatedAt;

  const summary = toSummary(normalizedState);

  fs.mkdirSync(paths.rootDir, { recursive: true });
  fs.writeFileSync(paths.statePath, `${JSON.stringify(normalizedState, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(paths.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

  return paths;
}

export function appendLiveSessionEvent(sessionName: string, event: LiveSessionEvent, cwd = process.cwd()): LiveSessionPaths {
  const paths = resolveLiveSessionPaths(cwd, sessionName);

  if (!shouldPersistLiveSessionEvent(event)) {
    return paths;
  }

  fs.mkdirSync(paths.rootDir, { recursive: true });
  fs.appendFileSync(paths.eventsPath, `${JSON.stringify(event)}\n`, 'utf-8');

  return paths;
}

export function resumeLiveSessionState(
  sessionName: string,
  cwd = process.cwd(),
  options: { startingCash?: number } = {},
): LiveSessionState {
  return loadLiveSessionState(sessionName, cwd, options);
}
