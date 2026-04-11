import {
  discoverActivePaperMarketRefs,
  fetchPaperMarketDetail,
  type PaperMarketAsset,
  type PaperMarketDetail,
  type PaperOrderBookLevel,
  type PaperMarketSnapshot,
} from './market-source.js';

const REALTIME_MARKET_SOCKET_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const DEFAULT_INITIAL_WAIT_MS = 1_500;
const DEFAULT_PING_INTERVAL_MS = 10_000;
const DEFAULT_STALE_AFTER_MS = 15_000;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

type RealtimeOutcomeSide = 'up' | 'down';

interface RealtimeTokenState {
  asset: PaperMarketAsset;
  side: RealtimeOutcomeSide;
  price: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  bids: PaperOrderBookLevel[];
  asks: PaperOrderBookLevel[];
  fetchedAt: string;
}

interface RealtimeAssetMetadata {
  detail: PaperMarketDetail;
  tokenIds: {
    up: string;
    down: string;
  };
}

interface RealtimeSocketMessageEvent {
  data: unknown;
}

interface RealtimeSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: RealtimeSocketMessageEvent) => void): void;
}

type RealtimeSocketFactory = (url: string) => RealtimeSocketLike | null;

export interface RealtimeSnapshotCache {
  latestByAsset: Partial<Record<PaperMarketAsset, PaperMarketSnapshot>>;
}

export interface RealtimeBestBidAskInput {
  asset: PaperMarketAsset;
  slug: string;
  question: string;
  bucketStartEpoch: number;
  bucketStartTime: string;
  fetchedAt: string;
  upPrice: number;
  downPrice: number;
  upAsk: number | null;
  downAsk: number | null;
  upOrderBook?: {
    bids: PaperOrderBookLevel[];
    asks: PaperOrderBookLevel[];
  };
  downOrderBook?: {
    bids: PaperOrderBookLevel[];
    asks: PaperOrderBookLevel[];
  };
  volume: number | null;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean | null;
  eventStartTime?: string | null;
  endDate?: string | null;
}

export interface RealtimePaperMarketSource {
  getLatestSnapshots: () => Promise<PaperMarketSnapshot[]>;
  close: () => Promise<void>;
}

export interface HybridPaperMarketSource {
  getCurrentSnapshots: () => Promise<PaperMarketSnapshot[]>;
  getSnapshotBySlug: (slug: string, asset: PaperMarketAsset) => Promise<PaperMarketSnapshot>;
  close: () => Promise<void>;
}

export interface RealtimePaperMarketSourceOptions {
  fetchImpl?: typeof fetch;
  websocketFactory?: RealtimeSocketFactory;
  now?: () => Date;
  initialWaitMs?: number;
  pingIntervalMs?: number;
  reconnectDelayMs?: number;
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

function normalizeBinaryPrice(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }

  return value;
}

function toIsoString(value: number | string | Date | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return new Date().toISOString();
}

function readBookLevelPrice(levels: unknown): number | null {
  if (!Array.isArray(levels) || levels.length === 0) {
    return null;
  }

  const first = levels[0];
  if (Array.isArray(first)) {
    return normalizeBinaryPrice(coerceNumber(first[0]));
  }

  if (typeof first === 'object' && first !== null) {
    return normalizeBinaryPrice(coerceNumber((first as Record<string, unknown>).price));
  }

  return normalizeBinaryPrice(coerceNumber(first));
}

function readOrderBookLevels(levels: unknown): PaperOrderBookLevel[] {
  if (!Array.isArray(levels)) {
    return [];
  }

  const normalized: PaperOrderBookLevel[] = [];
  for (const level of levels) {
    if (Array.isArray(level)) {
      const price = normalizeBinaryPrice(coerceNumber(level[0]));
      const size = coerceNumber(level[1]);
      if (price !== null && size !== null && size > 0) {
        normalized.push({ price, size });
      }
      continue;
    }

    if (typeof level !== 'object' || level === null) {
      continue;
    }

    const record = level as Record<string, unknown>;
    const price = normalizeBinaryPrice(coerceNumber(record.price));
    const size = coerceNumber(record.size);
    if (price !== null && size !== null && size > 0) {
      normalized.push({ price, size });
    }
  }

  return normalized;
}

function createTokenState(
  asset: PaperMarketAsset,
  side: RealtimeOutcomeSide,
): RealtimeTokenState {
  return {
    asset,
    side,
    price: null,
    bestBid: null,
    bestAsk: null,
    bids: [],
    asks: [],
    fetchedAt: new Date(0).toISOString(),
  };
}

function parseSocketData(data: unknown): unknown {
  if (typeof data === 'string') {
    return JSON.parse(data) as unknown;
  }

  if (data instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(data).toString('utf8')) as unknown;
  }

  if (ArrayBuffer.isView(data)) {
    return JSON.parse(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')) as unknown;
  }

  return data;
}

function sortSnapshots(snapshots: PaperMarketSnapshot[]): PaperMarketSnapshot[] {
  return [...snapshots].sort((left, right) => left.asset.localeCompare(right.asset));
}

function nextBucketRefreshTime(detailsByAsset: Partial<Record<PaperMarketAsset, RealtimeAssetMetadata>>): number {
  const bucketStarts = Object.values(detailsByAsset)
    .map((entry) => entry?.detail.bucketStartEpoch)
    .filter((value): value is number => typeof value === 'number');

  if (bucketStarts.length === 0) {
    return 0;
  }

  return Math.min(...bucketStarts) * 1000 + FIVE_MINUTES_MS;
}

function hasFreshSnapshots(
  snapshots: PaperMarketSnapshot[],
  now: () => Date,
  staleAfterMs: number,
): boolean {
  return snapshots.length === 2 && snapshots.every((snapshot) => {
    const fetchedAtMs = Date.parse(snapshot.fetchedAt);
    return Number.isFinite(fetchedAtMs) && now().getTime() - fetchedAtMs <= staleAfterMs;
  });
}

function hasVisibleBookDepth(snapshot: PaperMarketSnapshot): boolean {
  return Boolean(
    snapshot.upOrderBook
    && snapshot.downOrderBook
    && snapshot.upOrderBook.bids.length > 0
    && snapshot.upOrderBook.asks.length > 0
    && snapshot.downOrderBook.bids.length > 0
    && snapshot.downOrderBook.asks.length > 0,
  );
}

function looksLikeReliableBinarySnapshot(snapshot: PaperMarketSnapshot): boolean {
  if (
    snapshot.upPrice === null
    || snapshot.downPrice === null
    || !Number.isFinite(snapshot.upPrice)
    || !Number.isFinite(snapshot.downPrice)
  ) {
    return false;
  }

  const combinedPrice = snapshot.upPrice + snapshot.downPrice;
  if (Math.abs(combinedPrice - 1) > 0.08) {
    return false;
  }

  if (
    snapshot.upAsk !== null
    && snapshot.downAsk !== null
    && snapshot.upAsk >= 0.95
    && snapshot.downAsk >= 0.95
  ) {
    return false;
  }

  if (!hasVisibleBookDepth(snapshot)) {
    return false;
  }

  return true;
}

function getDefaultWebSocketFactory(): RealtimeSocketFactory {
  return (url: string) => new WebSocket(url) as unknown as RealtimeSocketLike;
}

export function createRealtimeSnapshotCache(): RealtimeSnapshotCache {
  return {
    latestByAsset: {},
  };
}

export function ingestRealtimeBestBidAsk(
  cache: RealtimeSnapshotCache,
  input: RealtimeBestBidAskInput,
): void {
  cache.latestByAsset[input.asset] = {
    asset: input.asset,
    slug: input.slug,
    question: input.question,
    active: input.active ?? true,
    closed: input.closed ?? false,
    acceptingOrders: input.acceptingOrders ?? true,
    eventStartTime: input.eventStartTime ?? input.bucketStartTime,
    endDate: input.endDate ?? new Date((input.bucketStartEpoch * 1000) + FIVE_MINUTES_MS).toISOString(),
    bucketStartTime: input.bucketStartTime,
    bucketStartEpoch: input.bucketStartEpoch,
    upPrice: input.upPrice,
    downPrice: input.downPrice,
    upAsk: input.upAsk,
    downAsk: input.downAsk,
    downAskDerivedFromBestBid: false,
    upOrderBook: input.upOrderBook,
    downOrderBook: input.downOrderBook,
    volume: input.volume,
    fetchedAt: input.fetchedAt,
  };
}

export function createHybridPaperMarketSource(input: {
  now?: () => Date;
  staleAfterMs?: number;
  pollingSource: {
    getCurrentSnapshots: () => Promise<PaperMarketSnapshot[]>;
    getSnapshotBySlug: (slug: string, asset: PaperMarketAsset) => Promise<PaperMarketSnapshot>;
  };
  realtimeSource: RealtimePaperMarketSource;
}): HybridPaperMarketSource {
  const now = input.now ?? (() => new Date());
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  return {
    async getCurrentSnapshots() {
      const realtimeSnapshots = sortSnapshots(await input.realtimeSource.getLatestSnapshots());
      if (
        hasFreshSnapshots(realtimeSnapshots, now, staleAfterMs)
        && realtimeSnapshots.every(looksLikeReliableBinarySnapshot)
      ) {
        return realtimeSnapshots;
      }

      return sortSnapshots(await input.pollingSource.getCurrentSnapshots());
    },
    getSnapshotBySlug(slug, asset) {
      return input.pollingSource.getSnapshotBySlug(slug, asset);
    },
    close() {
      return input.realtimeSource.close();
    },
  };
}

function maybePublishSnapshot(
  cache: RealtimeSnapshotCache,
  metadata: RealtimeAssetMetadata,
  tokenStates: Map<string, RealtimeTokenState>,
): void {
  const upTokenState = tokenStates.get(metadata.tokenIds.up);
  const downTokenState = tokenStates.get(metadata.tokenIds.down);

  if (!upTokenState || !downTokenState) {
    return;
  }

  if (upTokenState.price === null || downTokenState.price === null) {
    return;
  }

  ingestRealtimeBestBidAsk(cache, {
    asset: metadata.detail.asset,
    slug: metadata.detail.slug,
    question: metadata.detail.question,
    bucketStartEpoch: metadata.detail.bucketStartEpoch,
    bucketStartTime: metadata.detail.bucketStartTime,
    fetchedAt: upTokenState.fetchedAt >= downTokenState.fetchedAt ? upTokenState.fetchedAt : downTokenState.fetchedAt,
    upPrice: upTokenState.price,
    downPrice: downTokenState.price,
    upAsk: upTokenState.bestAsk,
    downAsk: downTokenState.bestAsk,
    upOrderBook: {
      bids: upTokenState.bids,
      asks: upTokenState.asks,
    },
    downOrderBook: {
      bids: downTokenState.bids,
      asks: downTokenState.asks,
    },
    volume: metadata.detail.volume,
    active: metadata.detail.active,
    closed: metadata.detail.closed,
    acceptingOrders: metadata.detail.acceptingOrders,
    eventStartTime: metadata.detail.eventStartTime,
    endDate: metadata.detail.endDate,
  });
}

function updateTokenState(
  tokenStates: Map<string, RealtimeTokenState>,
  tokenId: string,
  partial: Partial<Pick<RealtimeTokenState, 'price' | 'bestBid' | 'bestAsk' | 'bids' | 'asks' | 'fetchedAt'>>,
  metadataByTokenId: Map<string, { asset: PaperMarketAsset; side: RealtimeOutcomeSide }>,
): RealtimeTokenState | null {
  const metadata = metadataByTokenId.get(tokenId);
  if (!metadata) {
    return null;
  }

  const current = tokenStates.get(tokenId) ?? createTokenState(metadata.asset, metadata.side);
  const next: RealtimeTokenState = {
    ...current,
    price: partial.price ?? current.price,
    bestBid: partial.bestBid ?? current.bestBid,
    bestAsk: partial.bestAsk ?? current.bestAsk,
    bids: partial.bids ?? current.bids,
    asks: partial.asks ?? current.asks,
    fetchedAt: partial.fetchedAt ?? current.fetchedAt,
  };
  tokenStates.set(tokenId, next);
  return next;
}

function handleBookPayload(
  payload: Record<string, unknown>,
  metadataByTokenId: Map<string, { asset: PaperMarketAsset; side: RealtimeOutcomeSide }>,
  metadataByAsset: Partial<Record<PaperMarketAsset, RealtimeAssetMetadata>>,
  tokenStates: Map<string, RealtimeTokenState>,
  cache: RealtimeSnapshotCache,
): void {
  const tokenId = typeof payload.asset_id === 'string' ? payload.asset_id : null;
  if (!tokenId) {
    return;
  }

  const next = updateTokenState(tokenStates, tokenId, {
    price: normalizeBinaryPrice(coerceNumber(payload.last_trade_price)),
    bestBid: readBookLevelPrice(payload.bids),
    bestAsk: readBookLevelPrice(payload.asks),
    bids: readOrderBookLevels(payload.bids),
    asks: readOrderBookLevels(payload.asks),
    fetchedAt: toIsoString(typeof payload.timestamp === 'string' ? payload.timestamp : undefined),
  }, metadataByTokenId);

  if (!next) {
    return;
  }

  const metadata = metadataByAsset[next.asset];
  if (metadata) {
    maybePublishSnapshot(cache, metadata, tokenStates);
  }
}

function handlePriceChangePayload(
  payload: Record<string, unknown>,
  metadataByTokenId: Map<string, { asset: PaperMarketAsset; side: RealtimeOutcomeSide }>,
  metadataByAsset: Partial<Record<PaperMarketAsset, RealtimeAssetMetadata>>,
  tokenStates: Map<string, RealtimeTokenState>,
  cache: RealtimeSnapshotCache,
): void {
  const changes = Array.isArray(payload.price_changes) ? payload.price_changes : [];
  const eventTimestamp = toIsoString(typeof payload.timestamp === 'string' ? payload.timestamp : undefined);

  for (const item of changes) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }

    const tokenId = typeof item.asset_id === 'string' ? item.asset_id : null;
    if (!tokenId) {
      continue;
    }

    const next = updateTokenState(tokenStates, tokenId, {
      price: normalizeBinaryPrice(coerceNumber(item.price)),
      bestBid: normalizeBinaryPrice(coerceNumber(item.best_bid)),
      bestAsk: normalizeBinaryPrice(coerceNumber(item.best_ask)),
      fetchedAt: eventTimestamp,
    }, metadataByTokenId);

    if (!next) {
      continue;
    }

    const metadata = metadataByAsset[next.asset];
    if (metadata) {
      maybePublishSnapshot(cache, metadata, tokenStates);
    }
  }
}

export function createRealtimePaperMarketSource(
  options: RealtimePaperMarketSourceOptions = {},
): RealtimePaperMarketSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const websocketFactory = options.websocketFactory ?? getDefaultWebSocketFactory();
  const now = options.now ?? (() => new Date());
  const initialWaitMs = options.initialWaitMs ?? DEFAULT_INITIAL_WAIT_MS;
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const cache = createRealtimeSnapshotCache();
  const tokenStates = new Map<string, RealtimeTokenState>();
  const metadataByTokenId = new Map<string, { asset: PaperMarketAsset; side: RealtimeOutcomeSide }>();
  let metadataByAsset: Partial<Record<PaperMarketAsset, RealtimeAssetMetadata>> = {};
  let socket: RealtimeSocketLike | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let closed = false;
  let currentSignature = '';
  let refreshPromise: Promise<void> | null = null;
  let nextRefreshAt = 0;
  let readyWaiters: Array<() => void> = [];

  function resolveReadyWaiters(): void {
    if (cache.latestByAsset.BTC && cache.latestByAsset.ETH) {
      const pending = readyWaiters;
      readyWaiters = [];
      for (const resolve of pending) {
        resolve();
      }
    }
  }

  function clearSocketResources(): void {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (socket) {
      try {
        socket.close();
      } catch {
        // Ignore close failures while reconnecting.
      }
      socket = null;
    }
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void refreshRealtimeSubscription(true);
    }, reconnectDelayMs);
  }

  function handleSocketMessage(event: RealtimeSocketMessageEvent): void {
    let parsed: unknown;
    try {
      parsed = parseSocketData(event.data);
    } catch {
      return;
    }

    const messages = Array.isArray(parsed) ? parsed : [parsed];

    for (const entry of messages) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        continue;
      }

      const payload = entry as Record<string, unknown>;
      const eventType = typeof payload.event_type === 'string' ? payload.event_type : null;
      if (eventType === 'book') {
        handleBookPayload(payload, metadataByTokenId, metadataByAsset, tokenStates, cache);
      } else if (eventType === 'price_change') {
        handlePriceChangePayload(payload, metadataByTokenId, metadataByAsset, tokenStates, cache);
      }
    }

    resolveReadyWaiters();
  }

  function openSocket(detailsByAsset: Partial<Record<PaperMarketAsset, RealtimeAssetMetadata>>): void {
    clearSocketResources();
    let nextSocket: RealtimeSocketLike | null = null;
    try {
      nextSocket = websocketFactory(REALTIME_MARKET_SOCKET_URL);
    } catch {
      nextSocket = null;
    }

    if (!nextSocket) {
      return;
    }

    socket = nextSocket;

    nextSocket.addEventListener('open', () => {
      const tokenIds = Object.values(detailsByAsset)
        .flatMap((item) => item ? [item.tokenIds.up, item.tokenIds.down] : []);

      nextSocket.send(JSON.stringify({
        assets_ids: tokenIds,
        type: 'market',
        verbose: true,
        custom_feature_enabled: true,
      }));

      pingTimer = setInterval(() => {
        try {
          nextSocket.send('PING');
        } catch {
          // Let the close/reconnect path recover the socket.
        }
      }, pingIntervalMs);
    });

    nextSocket.addEventListener('message', handleSocketMessage);
    nextSocket.addEventListener('error', scheduleReconnect);
    nextSocket.addEventListener('close', () => {
      clearSocketResources();
      scheduleReconnect();
    });
  }

  async function refreshRealtimeSubscription(force = false): Promise<void> {
    if (closed) {
      return;
    }

    if (!force && refreshPromise) {
      return refreshPromise;
    }

    const nextRefresh = async () => {
      const shouldRefresh = force || !socket || now().getTime() >= nextRefreshAt;
      if (!shouldRefresh && cache.latestByAsset.BTC && cache.latestByAsset.ETH) {
        return;
      }

      const refs = await discoverActivePaperMarketRefs({
        fetchImpl,
        now: now(),
      });
      const details = await Promise.all(refs.map((ref) => fetchPaperMarketDetail(ref, { fetchImpl })));
      const signature = details.map((detail) => `${detail.asset}:${detail.slug}`).sort().join('|');

      if (!force && signature === currentSignature && socket) {
        nextRefreshAt = nextBucketRefreshTime(metadataByAsset);
        return;
      }

      currentSignature = signature;
      metadataByTokenId.clear();
      metadataByAsset = {};
      tokenStates.clear();
      cache.latestByAsset = {};

      for (const detail of details) {
        const entry: RealtimeAssetMetadata = {
          detail,
          tokenIds: {
            up: detail.upTokenId,
            down: detail.downTokenId,
          },
        };
        metadataByAsset[detail.asset] = entry;
        metadataByTokenId.set(detail.upTokenId, { asset: detail.asset, side: 'up' });
        metadataByTokenId.set(detail.downTokenId, { asset: detail.asset, side: 'down' });
      }

      nextRefreshAt = nextBucketRefreshTime(metadataByAsset);
      openSocket(metadataByAsset);
    };

    refreshPromise = nextRefresh().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  async function waitForReadySnapshots(): Promise<void> {
    if (cache.latestByAsset.BTC && cache.latestByAsset.ETH) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        readyWaiters = readyWaiters.filter((item) => item !== onReady);
        resolve();
      }, initialWaitMs);

      const onReady = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      readyWaiters.push(onReady);
    });
  }

  return {
    async getLatestSnapshots() {
      await refreshRealtimeSubscription();
      await waitForReadySnapshots();
      await refreshRealtimeSubscription();

      return sortSnapshots(
        (['BTC', 'ETH'] as const)
          .map((asset) => cache.latestByAsset[asset])
          .filter((snapshot): snapshot is PaperMarketSnapshot => snapshot !== undefined),
      );
    },
    async close() {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearSocketResources();
      readyWaiters = [];
    },
  };
}
