import fs from 'node:fs';

export interface BacktestRow {
  timestamp: string;
  market: string;
  timeframe: string;
  upPrice: number;
  downPrice: number;
  upBid?: number;
  upAsk?: number;
  downBid?: number;
  downAsk?: number;
  volume: number;
  outcome?: 'up' | 'down';
}

function parseNumber(value: string | undefined, columnName: string): number {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required numeric value for ${columnName}`);
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${columnName}: ${value}`);
  }

  return parsed;
}

function parseVolume(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    throw new Error('Missing required numeric value for volume');
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed;
}

function parseCsvLine(line: string): string[] {
  return line.split(',').map((value) => value.trim());
}

function parseOptionalNumber(
  value: string | undefined,
  columnName: string,
): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${columnName}: ${value}`);
  }

  return parsed;
}

export function loadBacktestRows(filePath: string): BacktestRow[] {
  const contents = fs.readFileSync(filePath, 'utf8');
  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0] ?? '');
  const requiredColumns = ['timestamp', 'market', 'timeframe', 'up_price', 'down_price', 'volume'];

  for (const column of requiredColumns) {
    if (!headers.includes(column)) {
      throw new Error(`Missing required CSV column: ${column}`);
    }
  }

  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  const rows: BacktestRow[] = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const timestamp = values[indexByHeader.get('timestamp') ?? -1];
    const market = values[indexByHeader.get('market') ?? -1];
    const timeframe = values[indexByHeader.get('timeframe') ?? -1];
    const upPrice = parseNumber(values[indexByHeader.get('up_price') ?? -1], 'up_price');
    const downPrice = parseNumber(values[indexByHeader.get('down_price') ?? -1], 'down_price');
    const upBid = parseOptionalNumber(values[indexByHeader.get('up_bid') ?? -1], 'up_bid');
    const upAsk = parseOptionalNumber(values[indexByHeader.get('up_ask') ?? -1], 'up_ask');
    const downBid = parseOptionalNumber(values[indexByHeader.get('down_bid') ?? -1], 'down_bid');
    const downAsk = parseOptionalNumber(values[indexByHeader.get('down_ask') ?? -1], 'down_ask');
    const volume = parseVolume(values[indexByHeader.get('volume') ?? -1]);
    const outcomeValue = values[indexByHeader.get('outcome') ?? -1];

    if (!timestamp || !market || !timeframe) {
      throw new Error(`Invalid CSV row: ${line}`);
    }
    if (upPrice < 0 || upPrice > 1) {
      throw new Error(`up_price must be within [0,1]: ${upPrice}`);
    }
    if (downPrice < 0 || downPrice > 1) {
      throw new Error(`down_price must be within [0,1]: ${downPrice}`);
    }
    if (upBid !== undefined && (upBid < 0 || upBid > 1)) {
      throw new Error(`up_bid must be within [0,1]: ${upBid}`);
    }
    if (upAsk !== undefined && (upAsk < 0 || upAsk > 1)) {
      throw new Error(`up_ask must be within [0,1]: ${upAsk}`);
    }
    if (downBid !== undefined && (downBid < 0 || downBid > 1)) {
      throw new Error(`down_bid must be within [0,1]: ${downBid}`);
    }
    if (downAsk !== undefined && (downAsk < 0 || downAsk > 1)) {
      throw new Error(`down_ask must be within [0,1]: ${downAsk}`);
    }
    if (volume < 0) {
      throw new Error(`volume must be non-negative: ${volume}`);
    }

    const row: BacktestRow = {
      timestamp,
      market,
      timeframe,
      upPrice,
      downPrice,
      upBid,
      upAsk,
      downBid,
      downAsk,
      volume,
    };

    if (outcomeValue === 'up' || outcomeValue === 'down') {
      row.outcome = outcomeValue;
    } else if (outcomeValue !== undefined && outcomeValue.length > 0) {
      throw new Error(`Invalid outcome value: ${outcomeValue}`);
    }

    rows.push(row);
  }

  return rows;
}
