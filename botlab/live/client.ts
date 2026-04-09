import { Wallet } from '@ethersproject/wallet';
import {
  AssetType,
  ClobClient,
  OrderType,
  Side,
  SignatureType,
  type ApiKeyCreds,
  type TickSize,
} from '@polymarket/clob-client';

export interface LiveBuyOrderRequest {
  tokenId: string;
  amount: number;
  priceLimit: number;
  tickSize: TickSize;
  negRisk: boolean;
  expectedTotalCost: number;
  expectedShares: number;
  expectedAveragePrice: number;
  expectedFeesPaid: number;
}

export interface LiveSellOrderRequest {
  tokenId: string;
  shares: number;
  priceLimit: number;
  tickSize: TickSize;
  negRisk: boolean;
  expectedGrossProceeds: number;
  expectedAveragePrice: number;
  expectedFeesPaid: number;
}

export interface LiveBuyOrderResult {
  orderId: string;
  status: string;
  tokenId: string;
  requestedAmount: number;
  spentAmount: number;
  shares: number;
  averagePrice: number;
  feesPaid: number;
}

export interface LiveSellOrderResult {
  orderId: string;
  status: string;
  tokenId: string;
  requestedShares: number;
  soldShares: number;
  averagePrice: number;
  grossProceeds: number;
  feesPaid: number;
  netProceeds: number;
}

export interface LiveTradingClient {
  getCollateralBalance(): Promise<number>;
  buyOutcome(input: LiveBuyOrderRequest): Promise<LiveBuyOrderResult | null>;
  sellOutcome(input: LiveSellOrderRequest): Promise<LiveSellOrderResult | null>;
}

export interface PolymarketLiveCredentials {
  host: string;
  chainId: 137 | 80002;
  privateKey: string;
  funderAddress: string;
  signatureType: SignatureType;
  apiCreds?: ApiKeyCreds;
}

function describeSignatureType(signatureType: SignatureType): string {
  if (signatureType === SignatureType.POLY_PROXY) {
    return 'POLY_PROXY';
  }
  if (signatureType === SignatureType.POLY_GNOSIS_SAFE) {
    return 'POLY_GNOSIS_SAFE';
  }

  return 'EOA';
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function sanitizePrivateKey(privateKey: string): string {
  return privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
}

export function normalizeCollateralBalance(rawBalance: string): number {
  const parsed = Number.parseFloat(rawBalance);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Received an invalid collateral balance from Polymarket: ${rawBalance}`);
  }

  if (rawBalance.includes('.') || rawBalance.includes('e') || rawBalance.includes('E')) {
    return parsed;
  }

  if (parsed >= 100_000) {
    return parsed / 1_000_000;
  }

  return parsed;
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value.trim();
}

export function loadPolymarketLiveCredentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PolymarketLiveCredentials {
  const host = env.POLYMARKET_HOST?.trim() || 'https://clob.polymarket.com';
  const chainId = env.POLYMARKET_CHAIN_ID === '80002' ? 80002 : 137;
  const privateKey = sanitizePrivateKey(requireEnv('POLYMARKET_PRIVATE_KEY', env.POLYMARKET_PRIVATE_KEY));
  const funderAddress = requireEnv('POLYMARKET_FUNDER_ADDRESS', env.POLYMARKET_FUNDER_ADDRESS);
  const signatureType = env.POLYMARKET_SIGNATURE_TYPE === '1'
    ? SignatureType.POLY_PROXY
    : env.POLYMARKET_SIGNATURE_TYPE === '2'
      ? SignatureType.POLY_GNOSIS_SAFE
      : SignatureType.EOA;

  const key = env.POLYMARKET_API_KEY?.trim();
  const secret = env.POLYMARKET_API_SECRET?.trim();
  const passphrase = env.POLYMARKET_API_PASSPHRASE?.trim();
  const apiCreds = key && secret && passphrase
    ? { key, secret, passphrase }
    : undefined;

  return {
    host,
    chainId,
    privateKey,
    funderAddress,
    signatureType,
    apiCreds,
  };
}

export async function createPolymarketLiveTradingClient(
  credentials: PolymarketLiveCredentials,
): Promise<LiveTradingClient> {
  const signer = new Wallet(credentials.privateKey);
  const authClient = new ClobClient(
    credentials.host,
    credentials.chainId,
    signer,
    undefined,
    credentials.signatureType,
    credentials.funderAddress,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );

  let apiCreds = credentials.apiCreds;
  if (!apiCreds) {
    let createError: unknown;
    let deriveError: unknown;

    try {
      apiCreds = await authClient.createApiKey();
    } catch (error) {
      createError = error;
      try {
        apiCreds = await authClient.deriveApiKey();
      } catch (fallbackError) {
        deriveError = fallbackError;
      }
    }

    if (!apiCreds) {
      const signerAddress = signer.address;
      const signatureTypeLabel = describeSignatureType(credentials.signatureType);
      const detailLines = [
        'Could not create or derive a Polymarket API key.',
        `Signer Address: ${signerAddress}`,
        `Funder Address: ${credentials.funderAddress}`,
        `Signature Type: ${signatureTypeLabel}`,
        `Create API Key Error: ${formatErrorMessage(createError)}`,
        `Derive API Key Error: ${formatErrorMessage(deriveError)}`,
        'Check that the funder address matches the address shown in your Polymarket account, the wallet is already usable on Polymarket, and the signature type matches the wallet setup.',
      ];

      throw new Error(detailLines.join('\n'));
    }
  }

  const tradingClient = new ClobClient(
    credentials.host,
    credentials.chainId,
    signer,
    apiCreds,
    credentials.signatureType,
    credentials.funderAddress,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );

  return {
    async getCollateralBalance() {
      const response = await tradingClient.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });
      return normalizeCollateralBalance(response.balance);
    },
    async buyOutcome(input) {
      const response = await tradingClient.createAndPostMarketOrder(
        {
          tokenID: input.tokenId,
          amount: input.amount,
          price: input.priceLimit,
          side: Side.BUY,
          orderType: OrderType.FAK,
        },
        {
          tickSize: input.tickSize,
          negRisk: input.negRisk,
        },
        OrderType.FAK,
      );

      if (!response || response.success !== true) {
        return null;
      }

      return {
        orderId: typeof response.orderID === 'string' ? response.orderID : '',
        status: typeof response.status === 'string' ? response.status : 'unknown',
        tokenId: input.tokenId,
        requestedAmount: input.amount,
        spentAmount: input.expectedTotalCost,
        shares: input.expectedShares,
        averagePrice: input.expectedAveragePrice,
        feesPaid: input.expectedFeesPaid,
      };
    },
    async sellOutcome(input) {
      const response = await tradingClient.createAndPostMarketOrder(
        {
          tokenID: input.tokenId,
          amount: input.shares,
          price: input.priceLimit,
          side: Side.SELL,
          orderType: OrderType.FAK,
        },
        {
          tickSize: input.tickSize,
          negRisk: input.negRisk,
        },
        OrderType.FAK,
      );

      if (!response || response.success !== true) {
        return null;
      }

      return {
        orderId: typeof response.orderID === 'string' ? response.orderID : '',
        status: typeof response.status === 'string' ? response.status : 'unknown',
        tokenId: input.tokenId,
        requestedShares: input.shares,
        soldShares: input.shares,
        averagePrice: input.expectedAveragePrice,
        grossProceeds: input.expectedGrossProceeds,
        feesPaid: input.expectedFeesPaid,
        netProceeds: input.expectedGrossProceeds - input.expectedFeesPaid,
      };
    },
  };
}
