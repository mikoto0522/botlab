import fs from 'node:fs/promises';

export type PaperMarketAsset = 'BTC' | 'ETH';

export interface PaperOrderBookLevel {
  price: number;
  size: number;
}

export interface PaperOutcomeOrderBook {
  bids: PaperOrderBookLevel[];
  asks: PaperOrderBookLevel[];
  lastTradePrice?: number | null;
}

export interface PaperMarketRef {
  asset: PaperMarketAsset;
  slug: string;
  bucketStartTime: string;
  bucketStartEpoch: number;
}

export interface PaperMarketSnapshot {
  asset: PaperMarketAsset;
  slug: string;
  question: string;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean | null;
  eventStartTime: string | null;
  endDate: string | null;
  bucketStartTime: string;
  bucketStartEpoch: number;
  upPrice: number | null;
  downPrice: number | null;
  upAsk: number | null;
  downAsk: number | null;
  downAskDerivedFromBestBid: boolean;
  upOrderBook?: PaperOutcomeOrderBook;
  downOrderBook?: PaperOutcomeOrderBook;
  volume: number | null;
  fetchedAt: string;
}

export interface PaperMarketDetail extends PaperMarketRef {
  question: string;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean | null;
  eventStartTime: string | null;
  endDate: string | null;
  upLabel: string;
  downLabel: string;
  upTokenId: string;
  downTokenId: string;
  volume: number | null;
  tickSize: '0.1' | '0.01' | '0.001' | '0.0001';
  negRisk: boolean;
}

export interface PaperMarketSourceOptions {
  fetchImpl?: typeof fetch;
  now?: Date | string | number;
}

type RawMarketSnapshot = Record<string, unknown>;

const GAMMA_API_BASE_URL = 'https://gamma-api.polymarket.com';
const CLOB_API_BASE_URL = 'https://clob.polymarket.com';
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const OFFICIAL_PRICE_SPREAD_THRESHOLD = 0.1;

function toDate(value: Date | string | number | undefined): Date {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value);
  }

  return new Date();
}

function toIsoString(value: Date | string | number | undefined): string {
  return toDate(value).toISOString();
}

function floorToFiveMinuteBucket(now: Date | string | number | undefined): Date {
  const date = toDate(now);
  const bucketStart = Math.floor(date.getTime() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;

  return new Date(bucketStart);
}

function bucketFromEpoch(bucketStartEpoch: number): { bucketStartEpoch: number; bucketStartTime: string } {
  return {
    bucketStartEpoch,
    bucketStartTime: new Date(bucketStartEpoch * 1000).toISOString(),
  };
}

function normalizeAssetSlug(asset: PaperMarketAsset, bucketStartEpoch: number): string {
  return `${asset.toLowerCase()}-updown-5m-${bucketStartEpoch}`;
}

function parseBucketStartEpochFromSlug(slug: string): number | null {
  const match = slug.match(/-(\d+)$/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }

  return null;
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function assertBinaryRange(value: number, label: string, sourceDescription: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `Failed to normalize paper market snapshot from ${sourceDescription}: ${label} must be within 0..1`,
    );
  }

  return value;
}

function parseNumberList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(coerceNumber).filter((item): item is number => item !== null);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseNumberList(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function parseRawStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(coerceString).filter((item): item is string => item !== null);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseRawStringList(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function readAsset(value: unknown, fixturePath: string): PaperMarketAsset {
  if (value === 'BTC' || value === 'ETH') {
    return value;
  }

  throw new Error(`Fixture snapshot has an invalid asset in ${fixturePath}; expected BTC or ETH`);
}

function readRequiredString(
  raw: RawMarketSnapshot,
  field: string,
  sourceDescription: string,
): string {
  const value = coerceString(raw[field]);
  if (!value) {
    throw new Error(`Failed to normalize paper market snapshot from ${sourceDescription}: ${field} must be a non-empty string`);
  }

  return value;
}

function classifyOutcomeLabel(label: string): 'up' | 'down' | null {
  const normalized = label.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/\bup\b/.test(normalized)) {
    return 'up';
  }
  if (/\bdown\b/.test(normalized)) {
    return 'down';
  }

  return null;
}

function readOutcomeOrder(rawOutcomes: unknown, sourceDescription: string): {
  upIndex: number;
  downIndex: number;
  upLabel: string;
  downLabel: string;
} {
  const labels = parseRawStringList(rawOutcomes);

  if (labels.length !== 2) {
    throw new Error(
      `Failed to normalize paper market snapshot from ${sourceDescription}: outcomes must be a 2-item array of Up/Down labels`,
    );
  }

  const classified = labels.map((label) => classifyOutcomeLabel(label));
  const upIndex = classified.indexOf('up');
  const downIndex = classified.indexOf('down');

  if (upIndex < 0 || downIndex < 0 || upIndex === downIndex) {
    throw new Error(
      `Failed to normalize paper market snapshot from ${sourceDescription}: outcomes must identify one Up label and one Down label`,
    );
  }

  return {
    upIndex,
    downIndex,
    upLabel: labels[upIndex] as string,
    downLabel: labels[downIndex] as string,
  };
}

function readRequiredPricePair(
  rawPrices: unknown,
  outcomeOrder: { upIndex: number; downIndex: number },
  sourceDescription: string,
): { upPrice: number; downPrice: number } {
  const prices = parseNumberList(rawPrices);

  if (prices.length !== 2) {
    throw new Error(
      `Failed to normalize paper market snapshot from ${sourceDescription}: outcomePrices must be a 2-item numeric array`,
    );
  }

  const upPrice = prices[outcomeOrder.upIndex];
  const downPrice = prices[outcomeOrder.downIndex];

  if (!Number.isFinite(upPrice) || !Number.isFinite(downPrice)) {
    throw new Error(
      `Failed to normalize paper market snapshot from ${sourceDescription}: outcomePrices do not match the Up/Down outcome order`,
    );
  }

  return {
    upPrice: assertBinaryRange(upPrice, 'outcomePrices upPrice', sourceDescription),
    downPrice: assertBinaryRange(downPrice, 'outcomePrices downPrice', sourceDescription),
  };
}

function readOptionalAskPair(
  raw: RawMarketSnapshot,
  outcomeOrder: { upIndex: number; downIndex: number },
  sourceDescription: string,
): { upAsk: number | null; downAsk: number | null; downAskDerivedFromBestBid: boolean } {
  const bestAskList = parseNumberList(raw.bestAsk);

  if (bestAskList.length === 2) {
    const upAsk = bestAskList[outcomeOrder.upIndex];
    const downAsk = bestAskList[outcomeOrder.downIndex];

    return {
      upAsk: Number.isFinite(upAsk) ? assertBinaryRange(upAsk, 'bestAsk upAsk', sourceDescription) : null,
      downAsk: Number.isFinite(downAsk) ? assertBinaryRange(downAsk, 'bestAsk downAsk', sourceDescription) : null,
      downAskDerivedFromBestBid: false,
    };
  }

  const scalarBestAsk = coerceNumber(raw.bestAsk);
  if (scalarBestAsk === null) {
    return {
      upAsk: null,
      downAsk: null,
      downAskDerivedFromBestBid: false,
    };
  }

  const bestBid = coerceNumber(raw.bestBid);
  const derivedDownAsk = bestBid === null ? null : 1 - bestBid;

  return {
    upAsk: assertBinaryRange(scalarBestAsk, 'bestAsk', sourceDescription),
    downAsk: derivedDownAsk === null ? null : assertBinaryRange(derivedDownAsk, 'derived downAsk from bestBid', sourceDescription),
    downAskDerivedFromBestBid: derivedDownAsk !== null,
  };
}

function readBucketTiming(raw: RawMarketSnapshot, ref?: PaperMarketRef): PaperMarketRef {
  if (ref) {
    return ref;
  }

  const bucketStartEpoch = coerceNumber(raw.bucketStartEpoch);
  if (bucketStartEpoch !== null) {
    const { bucketStartTime } = bucketFromEpoch(bucketStartEpoch);
    const slug = coerceString(raw.slug);
    if (!slug) {
      throw new Error('Missing slug for paper market snapshot');
    }

    return {
      asset: readAsset(raw.asset, 'fixture'),
      slug,
      bucketStartTime,
      bucketStartEpoch,
    };
  }

  const slug = coerceString(raw.slug);
  const slugEpoch = slug ? Number((slug.match(/-(\d+)$/)?.[1] ?? '')) : NaN;
  if (Number.isFinite(slugEpoch)) {
    const { bucketStartTime } = bucketFromEpoch(slugEpoch);
    return {
      asset: readAsset(raw.asset, 'fixture'),
      slug: slug as string,
      bucketStartTime,
      bucketStartEpoch: slugEpoch,
    };
  }

  throw new Error('Unable to determine paper market bucket timing');
}

function normalizeSnapshot(
  raw: RawMarketSnapshot,
  sourceDescription: string,
  ref?: PaperMarketRef,
): PaperMarketSnapshot {
  const bucketRef = readBucketTiming(raw, ref);
  const slug = readRequiredString(raw, 'slug', sourceDescription);
  const question = readRequiredString(raw, 'question', sourceDescription);
  const outcomes = parseRawStringList(raw.outcomes);
  const outcomeOrder = readOutcomeOrder(outcomes, sourceDescription);
  const prices = readRequiredPricePair(raw.outcomePrices, outcomeOrder, sourceDescription);
  const askPair = readOptionalAskPair(raw, outcomeOrder, sourceDescription);

  return {
    asset: bucketRef.asset,
    slug,
    question,
    active: coerceBoolean(raw.active) ?? false,
    closed: coerceBoolean(raw.closed) ?? false,
    acceptingOrders: coerceBoolean(raw.acceptingOrders),
    eventStartTime: coerceString(raw.eventStartTime),
    endDate: coerceString(raw.endDate),
    bucketStartTime: bucketRef.bucketStartTime,
    bucketStartEpoch: bucketRef.bucketStartEpoch,
    upPrice: prices.upPrice,
    downPrice: prices.downPrice,
    upAsk: askPair.upAsk,
    downAsk: askPair.downAsk,
    downAskDerivedFromBestBid: askPair.downAskDerivedFromBestBid,
    volume: coerceNumber(raw.volume),
    fetchedAt: toIsoString(raw.fetchedAt as Date | string | number | undefined),
  };
}

async function requestJson(fetchImpl: typeof fetch, url: string): Promise<RawMarketSnapshot> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch paper market snapshot from ${url}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as RawMarketSnapshot;
}

async function requestJsonArray(fetchImpl: typeof fetch, url: string): Promise<RawMarketSnapshot[]> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch active paper markets from ${url}: ${response.status} ${response.statusText}`);
  }

  const parsed = await response.json() as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Failed to fetch active paper markets from ${url}: response was not an array`);
  }

  return parsed.filter((item): item is RawMarketSnapshot => typeof item === 'object' && item !== null && !Array.isArray(item));
}

async function requestJsonArrayWithInit(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  failureLabel: string,
): Promise<RawMarketSnapshot[]> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${failureLabel} from ${url}: ${response.status} ${response.statusText}`);
  }

  const parsed = await response.json() as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Failed to fetch ${failureLabel} from ${url}: response was not an array`);
  }

  return parsed.filter((item): item is RawMarketSnapshot => typeof item === 'object' && item !== null && !Array.isArray(item));
}

async function requestJsonRecordWithInit(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  failureLabel: string,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${failureLabel} from ${url}: ${response.status} ${response.statusText}`);
  }

  const parsed = await response.json() as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Failed to fetch ${failureLabel} from ${url}: response was not an object`);
  }

  return parsed as Record<string, unknown>;
}

function normalizeOrderBookLevels(levels: unknown): PaperOrderBookLevel[] {
  if (!Array.isArray(levels)) {
    return [];
  }

  const normalized: PaperOrderBookLevel[] = [];
  for (const level of levels) {
    if (typeof level !== 'object' || level === null || Array.isArray(level)) {
      continue;
    }

    const price = normalizeBinaryPrice(coerceNumber((level as Record<string, unknown>).price));
    const size = coerceNumber((level as Record<string, unknown>).size);
    if (price === null || size === null || !Number.isFinite(size) || size <= 0) {
      continue;
    }

    normalized.push({ price, size });
  }

  return normalized;
}

function normalizeOptionalBinaryPrice(value: unknown): number | null {
  return normalizeBinaryPrice(coerceNumber(value));
}

function normalizeBinaryPrice(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }

  return value;
}

function normalizePaperMarketDetail(
  raw: RawMarketSnapshot,
  marketRef: PaperMarketRef,
  sourceDescription: string,
): PaperMarketDetail {
  const outcomes = readOutcomeOrder(raw.outcomes, sourceDescription);
  const tokenIds = parseRawStringList(raw.clobTokenIds);

  if (tokenIds.length !== 2) {
    throw new Error(
      `Failed to normalize paper market detail from ${sourceDescription}: clobTokenIds must be a 2-item array`,
    );
  }

  const upTokenId = tokenIds[outcomes.upIndex];
  const downTokenId = tokenIds[outcomes.downIndex];

  if (!upTokenId || !downTokenId) {
    throw new Error(
      `Failed to normalize paper market detail from ${sourceDescription}: clobTokenIds do not match the Up/Down outcome order`,
    );
  }

  const tickSize = coerceString(raw.minimum_tick_size);
  const negRisk = coerceBoolean(raw.neg_risk);

  return {
    ...marketRef,
    question: readRequiredString(raw, 'question', sourceDescription),
    active: coerceBoolean(raw.active) ?? false,
    closed: coerceBoolean(raw.closed) ?? false,
    acceptingOrders: coerceBoolean(raw.acceptingOrders),
    eventStartTime: coerceString(raw.eventStartTime),
    endDate: coerceString(raw.endDate),
    upLabel: outcomes.upLabel,
    downLabel: outcomes.downLabel,
    upTokenId,
    downTokenId,
    volume: coerceNumber(raw.volume),
    tickSize: tickSize === '0.1' || tickSize === '0.01' || tickSize === '0.001' || tickSize === '0.0001'
      ? tickSize
      : '0.01',
    negRisk: negRisk ?? false,
  };
}

async function fetchPaperOrderBooks(
  detail: PaperMarketDetail,
  fetchImpl: typeof fetch,
): Promise<{
  upOrderBook?: PaperOutcomeOrderBook;
  downOrderBook?: PaperOutcomeOrderBook;
}> {
  const rows = await requestJsonArrayWithInit(
    fetchImpl,
    `${CLOB_API_BASE_URL}/books`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        { token_id: detail.upTokenId },
        { token_id: detail.downTokenId },
      ]),
    },
    'paper market order books',
  );

  const booksByTokenId = new Map<string, RawMarketSnapshot>();
  for (const row of rows) {
    const tokenId = coerceString(row.asset_id);
    if (!tokenId) {
      continue;
    }

    booksByTokenId.set(tokenId, row);
  }

  const upBookRow = booksByTokenId.get(detail.upTokenId);
  const downBookRow = booksByTokenId.get(detail.downTokenId);

  return {
    upOrderBook: upBookRow
      ? {
          bids: normalizeOrderBookLevels(upBookRow.bids),
          asks: normalizeOrderBookLevels(upBookRow.asks),
          lastTradePrice: normalizeOptionalBinaryPrice(upBookRow.last_trade_price),
        }
      : undefined,
    downOrderBook: downBookRow
      ? {
          bids: normalizeOrderBookLevels(downBookRow.bids),
          asks: normalizeOrderBookLevels(downBookRow.asks),
          lastTradePrice: normalizeOptionalBinaryPrice(downBookRow.last_trade_price),
        }
      : undefined,
  };
}

function attachOrderBooks(
  snapshot: PaperMarketSnapshot,
  orderBooks: {
    upOrderBook?: PaperOutcomeOrderBook;
    downOrderBook?: PaperOutcomeOrderBook;
  },
): PaperMarketSnapshot {
  const nextSnapshot: PaperMarketSnapshot = {
    ...snapshot,
  };

  if (orderBooks.upOrderBook) {
    nextSnapshot.upOrderBook = orderBooks.upOrderBook;
    const bestAsk = orderBooks.upOrderBook.asks[0]?.price;
    if (typeof bestAsk === 'number' && Number.isFinite(bestAsk)) {
      nextSnapshot.upAsk = bestAsk;
    }
  }

  if (orderBooks.downOrderBook) {
    nextSnapshot.downOrderBook = orderBooks.downOrderBook;
    const bestAsk = orderBooks.downOrderBook.asks[0]?.price;
    if (typeof bestAsk === 'number' && Number.isFinite(bestAsk)) {
      nextSnapshot.downAsk = bestAsk;
      nextSnapshot.downAskDerivedFromBestBid = false;
    }
  }

  return nextSnapshot;
}

function parseMappedTokenPrice(
  rawMap: Record<string, unknown>,
  tokenId: string,
): number | null {
  return normalizeBinaryPrice(coerceNumber(rawMap[tokenId]));
}

function parseLastTradePriceMap(rows: RawMarketSnapshot[]): Map<string, number> {
  const prices = new Map<string, number>();

  for (const row of rows) {
    const tokenId = coerceString(row.token_id);
    const price = normalizeBinaryPrice(coerceNumber(row.price));
    if (!tokenId || price === null) {
      continue;
    }

    prices.set(tokenId, price);
  }

  return prices;
}

function selectOfficialDisplayPrice(input: {
  midpoint: number | null;
  spread: number | null;
  lastTradePrice: number | null;
}): number | null {
  if (
    input.midpoint !== null
    && input.spread !== null
    && input.spread <= OFFICIAL_PRICE_SPREAD_THRESHOLD
  ) {
    return input.midpoint;
  }

  if (input.lastTradePrice !== null) {
    return input.lastTradePrice;
  }

  return input.midpoint;
}

function normalizeBinaryDisplayPair(
  upPrice: number | null,
  downPrice: number | null,
): { upPrice: number | null; downPrice: number | null } {
  if (upPrice !== null && downPrice !== null && Math.abs((upPrice + downPrice) - 1) <= 0.08) {
    return { upPrice, downPrice };
  }

  if (upPrice !== null) {
    return {
      upPrice,
      downPrice: normalizeBinaryPrice(1 - upPrice),
    };
  }

  if (downPrice !== null) {
    return {
      upPrice: normalizeBinaryPrice(1 - downPrice),
      downPrice,
    };
  }

  return { upPrice: null, downPrice: null };
}

async function fetchOfficialDisplayPrices(
  detail: PaperMarketDetail,
  fetchImpl: typeof fetch,
): Promise<{ upPrice: number | null; downPrice: number | null }> {
  const requestBody = JSON.stringify([
    { token_id: detail.upTokenId },
    { token_id: detail.downTokenId },
  ]);

  const [midpoints, spreads, lastTrades] = await Promise.all([
    requestJsonRecordWithInit(
      fetchImpl,
      `${CLOB_API_BASE_URL}/midpoints`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: requestBody,
      },
      'paper market midpoint prices',
    ),
    requestJsonRecordWithInit(
      fetchImpl,
      `${CLOB_API_BASE_URL}/spreads`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: requestBody,
      },
      'paper market spreads',
    ),
    requestJsonArrayWithInit(
      fetchImpl,
      `${CLOB_API_BASE_URL}/last-trades-prices`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: requestBody,
      },
      'paper market last trade prices',
    ),
  ]);

  const lastTradePrices = parseLastTradePriceMap(lastTrades);
  const upPrice = selectOfficialDisplayPrice({
    midpoint: parseMappedTokenPrice(midpoints, detail.upTokenId),
    spread: parseMappedTokenPrice(spreads, detail.upTokenId),
    lastTradePrice: lastTradePrices.get(detail.upTokenId) ?? null,
  });
  const downPrice = selectOfficialDisplayPrice({
    midpoint: parseMappedTokenPrice(midpoints, detail.downTokenId),
    spread: parseMappedTokenPrice(spreads, detail.downTokenId),
    lastTradePrice: lastTradePrices.get(detail.downTokenId) ?? null,
  });

  return normalizeBinaryDisplayPair(upPrice, downPrice);
}

function fallbackDisplayPricesFromOrderBooks(
  snapshot: PaperMarketSnapshot,
): { upPrice: number | null; downPrice: number | null } {
  const upLastTrade = snapshot.upOrderBook?.lastTradePrice ?? null;
  const downLastTrade = snapshot.downOrderBook?.lastTradePrice ?? null;

  return normalizeBinaryDisplayPair(
    upLastTrade ?? snapshot.upPrice,
    downLastTrade ?? snapshot.downPrice,
  );
}

export function resolveCurrentPaperMarketRefs(now: Date | string | number = new Date()): PaperMarketRef[] {
  const bucketStart = floorToFiveMinuteBucket(now);
  const bucketStartEpoch = Math.floor(bucketStart.getTime() / 1000);
  const bucketStartTime = bucketStart.toISOString();

  return [
    {
      asset: 'BTC',
      slug: normalizeAssetSlug('BTC', bucketStartEpoch),
      bucketStartTime,
      bucketStartEpoch,
    },
    {
      asset: 'ETH',
      slug: normalizeAssetSlug('ETH', bucketStartEpoch),
      bucketStartTime,
      bucketStartEpoch,
    },
  ];
}

export async function discoverActivePaperMarketRefs(
  options: PaperMarketSourceOptions = {},
): Promise<PaperMarketRef[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rows = await requestJsonArray(fetchImpl, `${GAMMA_API_BASE_URL}/markets`);
  const discovered = new Map<PaperMarketAsset, PaperMarketRef[]>();
  const currentRefs = resolveCurrentPaperMarketRefs(options.now);
  const currentEpochByAsset = new Map<PaperMarketAsset, number>(
    currentRefs.map((ref) => [ref.asset, ref.bucketStartEpoch]),
  );

  for (const row of rows) {
    const slug = coerceString(row.slug);
    if (!slug || (slug.startsWith('btc-updown-5m-') === false && slug.startsWith('eth-updown-5m-') === false)) {
      continue;
    }
    if (coerceBoolean(row.active) !== true || coerceBoolean(row.closed) === true) {
      continue;
    }

    const asset: PaperMarketAsset = slug.startsWith('btc-') ? 'BTC' : 'ETH';
    const bucketStartEpoch = parseBucketStartEpochFromSlug(slug);
    if (bucketStartEpoch === null) {
      continue;
    }

    const candidates = discovered.get(asset) ?? [];
    candidates.push({
      asset,
      slug,
      bucketStartEpoch,
      bucketStartTime: new Date(bucketStartEpoch * 1000).toISOString(),
    });
    discovered.set(asset, candidates);
  }

  if (discovered.has('BTC') && discovered.has('ETH')) {
    return (['BTC', 'ETH'] as const).map((asset) => {
      const currentEpoch = currentEpochByAsset.get(asset) ?? 0;
      const candidates = discovered.get(asset) ?? [];
      const exactCurrent = candidates.find((candidate) => candidate.bucketStartEpoch === currentEpoch);
      if (exactCurrent) {
        return exactCurrent;
      }

      const priorOrCurrent = candidates
        .filter((candidate) => candidate.bucketStartEpoch <= currentEpoch)
        .sort((left, right) => right.bucketStartEpoch - left.bucketStartEpoch)[0];
      if (priorOrCurrent) {
        return priorOrCurrent;
      }

      return [...candidates].sort((left, right) => left.bucketStartEpoch - right.bucketStartEpoch)[0]!;
    });
  }

  return currentRefs;
}

export async function fetchPaperMarketSnapshot(
  marketRef: PaperMarketRef,
  options: PaperMarketSourceOptions = {},
): Promise<PaperMarketSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const raw = await requestJson(fetchImpl, `${GAMMA_API_BASE_URL}/markets/slug/${marketRef.slug}`);
  const responseSlug = coerceString(raw.slug);

  if (responseSlug !== marketRef.slug) {
    throw new Error(
      `Failed to normalize paper market snapshot from ${marketRef.asset} live response: response slug ${responseSlug ?? 'missing'} does not match requested slug ${marketRef.slug}`,
    );
  }

  const snapshot = normalizeSnapshot(
    {
      ...raw,
      fetchedAt: options.now ? toIsoString(options.now) : raw.fetchedAt,
    },
    `${marketRef.asset} live response`,
    marketRef,
  );

  try {
    const detail = normalizePaperMarketDetail(raw, marketRef, `${marketRef.asset} live response`);
    const orderBooks = await fetchPaperOrderBooks(detail, fetchImpl);
    const withOrderBooks = attachOrderBooks(snapshot, orderBooks);

    try {
      const officialDisplayPrices = await fetchOfficialDisplayPrices(detail, fetchImpl);
      return {
        ...withOrderBooks,
        upPrice: officialDisplayPrices.upPrice ?? withOrderBooks.upPrice,
        downPrice: officialDisplayPrices.downPrice ?? withOrderBooks.downPrice,
      };
    } catch {
      const fallbackDisplayPrices = fallbackDisplayPricesFromOrderBooks(withOrderBooks);
      return {
        ...withOrderBooks,
        upPrice: fallbackDisplayPrices.upPrice ?? withOrderBooks.upPrice,
        downPrice: fallbackDisplayPrices.downPrice ?? withOrderBooks.downPrice,
      };
    }
  } catch {
    return snapshot;
  }
}

export async function fetchPaperMarketDetail(
  marketRef: PaperMarketRef,
  options: PaperMarketSourceOptions = {},
): Promise<PaperMarketDetail> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const raw = await requestJson(fetchImpl, `${GAMMA_API_BASE_URL}/markets/slug/${marketRef.slug}`);
  const responseSlug = coerceString(raw.slug);

  if (responseSlug !== marketRef.slug) {
    throw new Error(
      `Failed to normalize paper market detail from ${marketRef.asset} live response: response slug ${responseSlug ?? 'missing'} does not match requested slug ${marketRef.slug}`,
    );
  }

  return normalizePaperMarketDetail(raw, marketRef, `${marketRef.asset} live response`);
}

export function createLivePaperMarketSource(options: PaperMarketSourceOptions = {}) {
  return async () => {
    const refs = await discoverActivePaperMarketRefs(options);
    const fetchImpl = options.fetchImpl ?? fetch;

    return Promise.all(refs.map((ref) => fetchPaperMarketSnapshot(ref, { fetchImpl, now: options.now })));
  };
}

export function createFixturePaperMarketSource(fixturePath: string) {
  return async () => {
    const raw = await fs.readFile(fixturePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error(`Fixture file must contain a JSON array of paper market snapshots: ${fixturePath}`);
    }

    return parsed.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error(`Fixture file contains an invalid snapshot entry: ${fixturePath}`);
      }

      const rawSnapshot = item as RawMarketSnapshot;
      const asset = readAsset(rawSnapshot.asset, fixturePath);
      const slug = readRequiredString(rawSnapshot, 'slug', fixturePath);
      const bucketStartEpoch = coerceNumber(rawSnapshot.bucketStartEpoch);
      const bucketRef = bucketStartEpoch !== null
        ? {
            asset,
            slug,
            ...bucketFromEpoch(bucketStartEpoch),
          }
        : readBucketTiming(rawSnapshot, {
            asset,
            slug,
            bucketStartTime: coerceString(rawSnapshot.bucketStartTime) ?? coerceString(rawSnapshot.eventStartTime) ?? bucketFromEpoch(0).bucketStartTime,
            bucketStartEpoch: coerceNumber(rawSnapshot.bucketStartEpoch) ?? 0,
          });

      return normalizeSnapshot(
        {
          ...rawSnapshot,
          asset,
          slug,
          bucketStartEpoch: bucketRef.bucketStartEpoch,
          bucketStartTime: bucketRef.bucketStartTime,
        },
        fixturePath,
        bucketRef,
      );
    });
  };
}
