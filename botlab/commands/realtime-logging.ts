import { formatBacktestNumber } from './backtest-common.js';

interface DecisionSummary {
  asset: string;
  action: string;
  side?: string;
  reason: string;
  marketSlug: string;
  upPrice: number | null;
  downPrice: number | null;
  upAsk: number | null;
  downAsk: number | null;
}

interface CycleReport {
  type: 'cycle' | 'error';
  timestamp: string;
  cycleCount: number;
  cash: number;
  equity: number;
  openedCount: number;
  closedCount: number;
  settledCount: number;
  decisions?: DecisionSummary[];
  snapshots?: Partial<Record<'BTC' | 'ETH', Record<string, unknown>>>;
  errorMessage?: string;
}

export interface RealtimeConnectionEvent {
  type: 'connected' | 'reconnecting' | 'reconnected' | 'fatal';
  timestamp: string;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  message?: string;
}

interface LoggerOptions {
  write?: (line: string) => void;
}

interface PersistedRealtimeConnectionEvent {
  type: string;
  timestamp: string;
  status: RealtimeConnectionEvent['type'];
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  message?: string;
  [key: string]: unknown;
}

interface ConnectionReporterOptions extends LoggerOptions {
  appendEvent?: (event: PersistedRealtimeConnectionEvent) => void;
}

interface CycleLoggerOptions extends LoggerOptions {
  heartbeatIntervalMs?: number;
}

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

function formatDecisionSummary(report: DecisionSummary): string {
  const prices = `price up=${report.upPrice ?? 'n/a'} down=${report.downPrice ?? 'n/a'}`;
  const marketSlug = report.marketSlug ? ` ${report.marketSlug}` : '';
  const side = report.side === 'flat' ? '' : ` ${report.side ?? ''}`;

  return `${report.asset}${marketSlug} ${report.action}${side} (${prices})`;
}

function formatHeartbeatSnapshot(
  asset: 'BTC' | 'ETH',
  snapshot: Record<string, unknown> | undefined,
): string | null {
  if (!snapshot) {
    return null;
  }

  const upPrice = typeof snapshot.upPrice === 'number' && Number.isFinite(snapshot.upPrice)
    ? formatBacktestNumber(snapshot.upPrice)
    : 'n/a';
  const downPrice = typeof snapshot.downPrice === 'number' && Number.isFinite(snapshot.downPrice)
    ? formatBacktestNumber(snapshot.downPrice)
    : 'n/a';

  return `${asset} up=${upPrice} down=${downPrice}`;
}

export function createQuietCycleLogger(
  mode: 'paper' | 'live',
  options: CycleLoggerOptions = {},
): (report: CycleReport) => void {
  const write = options.write ?? ((line: string) => console.log(line));
  const heartbeatIntervalMs = Math.max(1, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  let lastHeartbeatAtMs = Number.NEGATIVE_INFINITY;

  return (report: CycleReport) => {
    if (report.type === 'error') {
      write(`[${report.timestamp}] cycle ${report.cycleCount}: skipped (${report.errorMessage})`);
      return;
    }

    if (report.openedCount > 0 || report.closedCount > 0 || report.settledCount > 0) {
      const decisions = (report.decisions ?? []).map(formatDecisionSummary).join(' | ');
      write(
        `[${report.timestamp}] cycle ${report.cycleCount}: ${decisions || 'no decisions'} | opened=${report.openedCount} closed=${report.closedCount} settled=${report.settledCount} | cash=${formatBacktestNumber(report.cash)} equity=${formatBacktestNumber(report.equity)}`,
      );
      return;
    }

    const reportTimestampMs = Date.parse(report.timestamp);
    if (!Number.isFinite(reportTimestampMs) || reportTimestampMs - lastHeartbeatAtMs >= heartbeatIntervalMs) {
      if (Number.isFinite(reportTimestampMs)) {
        lastHeartbeatAtMs = reportTimestampMs;
      }
      const snapshotSummary = (['BTC', 'ETH'] as const)
        .map((asset) => formatHeartbeatSnapshot(asset, report.snapshots?.[asset]))
        .filter((entry): entry is string => entry !== null)
        .join(' | ');
      write(
        `[${report.timestamp}] ${mode} heartbeat: connected | cycles=${report.cycleCount} cash=${formatBacktestNumber(report.cash)} equity=${formatBacktestNumber(report.equity)}${snapshotSummary ? ` | ${snapshotSummary}` : ''}`,
      );
    }
  };
}

export function createRealtimeConnectionReporter(
  mode: 'paper' | 'live',
  options: ConnectionReporterOptions = {},
): (event: RealtimeConnectionEvent) => void {
  const write = options.write ?? ((line: string) => console.log(line));

  return (event: RealtimeConnectionEvent) => {
    const persistedEvent: PersistedRealtimeConnectionEvent = {
      type: `${mode}-realtime-connection`,
      timestamp: event.timestamp,
      status: event.type,
      ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
      ...(event.maxAttempts === undefined ? {} : { maxAttempts: event.maxAttempts }),
      ...(event.delayMs === undefined ? {} : { delayMs: event.delayMs }),
      ...(event.message === undefined ? {} : { message: event.message }),
    };
    options.appendEvent?.(persistedEvent);

    if (event.type === 'connected') {
      write(`[${event.timestamp}] ${mode} realtime connected`);
      return;
    }

    if (event.type === 'reconnected') {
      write(`[${event.timestamp}] ${mode} realtime reconnected`);
      return;
    }

    if (event.type === 'reconnecting') {
      const attempt = event.attempt ?? '?';
      const maxAttempts = event.maxAttempts ?? '?';
      const delaySeconds = typeof event.delayMs === 'number'
        ? Math.max(0, Math.round(event.delayMs / 1000))
        : '?';
      write(`[${event.timestamp}] ${mode} realtime reconnecting (attempt ${attempt}/${maxAttempts} in ${delaySeconds}s)`);
      return;
    }

    write(`[${event.timestamp}] ${mode} realtime stopped (${event.message ?? 'unknown realtime failure'})`);
  };
}

export const createRealtimeConnectionLogger = createRealtimeConnectionReporter;
