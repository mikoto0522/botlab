export type BotlabMode = 'dry-run' | 'paper' | 'live';

export type StrategyDecisionAction = 'buy' | 'sell' | 'hold';

export type BotlabPositionSide = 'flat' | 'long' | 'short';

export type PredictionSide = 'flat' | 'up' | 'down';

export interface BotlabCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BotlabMarketRuntime {
  asset: string;
  symbol: string;
  timeframe: string;
  price: number;
  upPrice?: number;
  downPrice?: number;
  upAsk?: number;
  downAsk?: number;
  changePct24h: number;
  momentum: number;
  volume: number;
  timestamp: string;
  candles: BotlabCandle[];
}

export interface BotlabRelatedMarketRuntime {
  asset: string;
  symbol: string;
  timeframe: string;
  price: number;
  upPrice?: number;
  downPrice?: number;
  upAsk?: number;
  downAsk?: number;
  volume: number;
  timestamp: string;
  candles: BotlabCandle[];
}

export interface BotlabHedgeContext {
  mode: BotlabMode;
  markets: BotlabRelatedMarketRuntime[];
  balance: number;
  clock: {
    now: string;
  };
}

export interface BotlabPositionRuntime {
  side: BotlabPositionSide;
  size: number;
  entryPrice: number | null;
}

export interface BacktestTrade {
  side: Exclude<PredictionSide, 'flat'>;
  entryTimestamp: string;
  exitTimestamp: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  feesPaid: number;
  realizedPnl: number;
}

export interface BacktestEquityPoint {
  timestamp: string;
  cash: number;
  equity: number;
}

export interface BacktestSummary {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  feeTotal: number;
  endingEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  settled: boolean;
}

export interface BatchBacktestSummary extends BacktestSummary {
  upTradeCount: number;
  downTradeCount: number;
  skippedCount: number;
}

export interface BatchBacktestResult {
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
  summary: BatchBacktestSummary;
}

export interface HedgeBacktestLeg {
  asset: string;
  market: string;
  side: Exclude<PredictionSide, 'flat'>;
  entryTimestamp: string;
  exitTimestamp: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  feesPaid: number;
  realizedPnl: number;
}

export interface HedgeBacktestTrade {
  entryTimestamp: string;
  exitTimestamp: string;
  reason: string;
  feesPaid: number;
  realizedPnl: number;
  legs: HedgeBacktestLeg[];
}

export interface HedgeBacktestSummary extends BacktestSummary {
  legCount: number;
  skippedGroups: number;
}

export interface HedgeBacktestResult {
  equityCurve: BacktestEquityPoint[];
  trades: HedgeBacktestTrade[];
  summary: HedgeBacktestSummary;
}

export interface BotlabStrategyContext {
  mode: BotlabMode;
  market: BotlabMarketRuntime;
  relatedMarkets?: BotlabRelatedMarketRuntime[];
  position: BotlabPositionRuntime;
  balance: number;
  clock: {
    now: string;
  };
}

export type StrategyContext = BotlabStrategyContext;

export type BotlabRuntimeConfig = BotlabStrategyContext;

export interface BotlabPaths {
  rootDir: string;
  strategyDir: string;
  templateDir: string;
  defaultConfigPath: string;
}

export interface BotlabConfig {
  paths: BotlabPaths;
  runtime: BotlabRuntimeConfig;
  strategyParams?: Record<string, Record<string, unknown>>;
}

export type StrategyAction = 'buy' | 'sell' | 'hold';

export interface BotlabStrategyDecision {
  action: StrategyAction;
  reason: string;
  size?: number;
  tags?: string[];
  side?: Exclude<PredictionSide, 'flat'>;
}

export type StrategyDecision = BotlabStrategyDecision;

export interface BotlabHedgeLegDecision {
  asset: string;
  side: Exclude<PredictionSide, 'flat'>;
  size: number;
}

export interface BotlabHedgeDecision {
  action: 'hedge' | 'hold';
  reason: string;
  legs?: BotlabHedgeLegDecision[];
  tags?: string[];
}

export interface BotlabStrategyDefinition<TParams extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  defaults: TParams;
  evaluate: (context: BotlabStrategyContext, params: TParams) => BotlabStrategyDecision;
  evaluateHedge?: (context: BotlabHedgeContext, params: TParams) => BotlabHedgeDecision;
  shouldEnter?: (context: BotlabStrategyContext, params: TParams) => boolean;
  shouldExit?: (context: BotlabStrategyContext, params: TParams) => boolean;
}

export type StrategyDefinition<TParams extends Record<string, unknown> = Record<string, unknown>> = BotlabStrategyDefinition<TParams>;
