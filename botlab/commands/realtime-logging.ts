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
      write(
        `[${report.timestamp}] ${mode} heartbeat: connected | cycles=${report.cycleCount} cash=${formatBacktestNumber(report.cash)} equity=${formatBacktestNumber(report.equity)}`,
      );
    }
  };
}

export function createRealtimeConnectionLogger(
  mode: 'paper' | 'live',
  options: LoggerOptions = {},
): (event: RealtimeConnectionEvent) => void {
  const write = options.write ?? ((line: string) => console.log(line));

  return (event: RealtimeConnectionEvent) => {
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
