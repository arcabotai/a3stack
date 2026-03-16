/**
 * @a3stack/payments — Type Definitions
 *
 * x402 supports any ERC-20 token via Permit2 + EIP-3009.
 * USDC is the default; pass any token address via the `asset` field.
 */

export interface PaymentClientConfig {
  /**
   * viem Account (e.g. from privateKeyToAccount())
   * Must have signTypedData for payment signing.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  account: any;
  /**
   * Supported chains in CAIP-2 format.
   * Defaults to ["eip155:*"] (all EVM chains)
   */
  chains?: string[];
  /**
   * Maximum token amount (in base units) to auto-pay per request.
   * e.g. "1000000" = 1.00 USDC (6 decimals)
   * Defaults to "10000000" (10 USDC)
   */
  maxAmountPerRequest?: string;
}

export interface PaymentServerConfig {
  /** Address to receive payments */
  payTo: `0x${string}`;
  /**
   * Required payment amount in token base units.
   * e.g. "100000" = 0.10 USDC (6 decimals)
   */
  amount: string;
  /**
   * ERC-20 token address to accept. Defaults to USDC on the configured network.
   * Any ERC-20 token is supported via Permit2 + EIP-3009.
   */
  asset?: `0x${string}`;
  /**
   * Network in CAIP-2 format. Defaults to "eip155:8453" (Base mainnet)
   */
  network?: string;
  /**
   * Description shown in payment requirements
   */
  description?: string;
  /**
   * Max timeout for payment verification in seconds. Defaults to 300.
   */
  maxTimeoutSeconds?: number;
}

export interface PaymentDetails {
  from: `0x${string}`;
  to: `0x${string}`;
  amount: string;
  asset: `0x${string}`;
  network: string;
  txHash?: `0x${string}`;
  timestamp: number;
}

export interface PaymentVerifyResult {
  valid: boolean;
  payment?: PaymentDetails;
  error?: string;
}

export interface PaymentBalance {
  amount: bigint;
  formatted: string;
  symbol: string;
  decimals: number;
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: unknown;
  extra?: Record<string, unknown>;
}

/**
 * Middleware context — added to express req/res
 */
export interface PaymentContext {
  payment: PaymentDetails;
  requirements: PaymentRequirements;
}
