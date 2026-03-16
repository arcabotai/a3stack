/**
 * Payment Client — wraps x402/fetch for easy agent-to-agent payments
 *
 * Supports any ERC-20 token via Permit2 + EIP-3009. Defaults to USDC.
 */

import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import type { Account } from "viem";
import {
  DEFAULT_MAX_AMOUNT,
  NETWORK_USDC,
  DEFAULT_NETWORK,
  ERC20_ABI,
  NETWORK_RPC,
  BASE_RPC,
} from "./constants.js";
import type {
  PaymentClientConfig,
  PaymentBalance,
  PaymentDetails,
} from "./types.js";

export class PaymentClient {
  private config: PaymentClientConfig;
  private _paidFetch?: typeof fetch;

  constructor(config: PaymentClientConfig) {
    this.config = {
      ...config,
      chains: config.chains ?? ["eip155:*"],
      maxAmountPerRequest: config.maxAmountPerRequest ?? DEFAULT_MAX_AMOUNT,
    };
  }

  /**
   * Initialize the payment-wrapped fetch (lazy — only creates when first used)
   */
  private async getPaidFetch(): Promise<typeof fetch> {
    if (this._paidFetch) return this._paidFetch;

    // Dynamic import to avoid bundling issues
    const [{ wrapFetchWithPaymentFromConfig }, { ExactEvmScheme, toClientEvmSigner }] = await Promise.all([
      import("@x402/fetch"),
      import("@x402/evm"),
    ]);

    const account = this.config.account as Account;
    const chains = this.config.chains!;

    // ExactEvmScheme requires a ClientEvmSigner with address + signTypedData + readContract
    // We build a minimal signer from the viem account + a public client for readContract
    const rpcUrl = BASE_RPC;
    const publicClient = createPublicClient({ transport: http(rpcUrl) });

    // Build a ClientEvmSigner manually
    const signer = toClientEvmSigner({
      address: account.address,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signTypedData: (params: any) => account.signTypedData?.(params) ?? Promise.reject(new Error("signTypedData not available on this account")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      readContract: (params: any) => publicClient.readContract(params),
    } as Parameters<typeof toClientEvmSigner>[0]);

    // Build scheme registrations
    const schemes = chains.map((network) => ({
      network: network as `${string}:${string}`,
      client: new ExactEvmScheme(signer),
    }));

    this._paidFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes });
    return this._paidFetch;
  }

  /**
   * A fetch function that automatically handles x402 payment challenges
   */
  get fetch(): (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response> {
    return async (input, init) => {
      const paidFetch = await this.getPaidFetch();
      return paidFetch(input, init);
    };
  }

  /**
   * Create a payment-capable fetch pre-configured for a specific agent.
   * The wallet is resolved automatically from the 402 payment requirements.
   */
  fetchForWallet(
    _paymentWallet: `0x${string}`
  ): (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response> {
    // The x402 protocol handles payment wallet resolution automatically via 402 response
    // This just returns the standard paid fetch — the wallet in payment requirements 
    // is provided by the server's 402 response
    return this.fetch;
  }

  /**
   * Check your token balance on a network.
   * Defaults to USDC. Pass any ERC-20 token address to check other tokens.
   */
  async getBalance(
    network = DEFAULT_NETWORK,
    rpc?: string,
    tokenAddress?: `0x${string}`
  ): Promise<PaymentBalance> {
    const asset = tokenAddress ?? NETWORK_USDC[network];
    if (!asset) {
      throw new Error(
        `No default token address for network "${network}". ` +
          `Pass a tokenAddress or use a supported network: ${Object.keys(NETWORK_USDC).join(", ")}`
      );
    }

    const rpcUrl = rpc ?? NETWORK_RPC[network] ?? BASE_RPC;
    const client = createPublicClient({ transport: http(rpcUrl) });

    const [rawBalance, decimals, symbol] = await Promise.all([
      client.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [this.config.account.address],
      }) as Promise<bigint>,
      client.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "decimals",
      }) as Promise<number>,
      client.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "symbol",
      }) as Promise<string>,
    ]);

    return {
      amount: rawBalance,
      formatted: formatUnits(rawBalance, decimals),
      symbol,
      decimals,
    };
  }

  /**
   * Decode payment receipt from a successful x402 response
   * Returns null if no payment was made (wasn't a 402 endpoint)
   */
  decodeReceipt(response: Response): PaymentDetails | null {
    const paymentResponseHeader = response.headers.get("x-payment-response") ??
      response.headers.get("PAYMENT-RESPONSE");
    if (!paymentResponseHeader) return null;

    try {
      // The x402 response header contains base64-encoded payment details
      const decoded = JSON.parse(
        Buffer.from(paymentResponseHeader, "base64").toString("utf8")
      );
      return {
        from: decoded.sender ?? decoded.from,
        to: decoded.recipient ?? decoded.to ?? decoded.payTo,
        amount: decoded.amount ?? decoded.value,
        asset: decoded.asset ?? decoded.token,
        network: decoded.network ?? decoded.chain ?? DEFAULT_NETWORK,
        txHash: decoded.txHash ?? decoded.hash,
        timestamp: decoded.timestamp ?? Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if an endpoint requires payment (without making the actual request)
   */
  async checkPaymentRequirements(url: string): Promise<{
    requiresPayment: boolean;
    amount?: string;
    asset?: string;
    network?: string;
    payTo?: string;
  }> {
    const response = await fetch(url, { method: "HEAD" });

    if (response.status !== 402) {
      return { requiresPayment: false };
    }

    const reqHeader = response.headers.get("x-payment-required") ??
      response.headers.get("X-PAYMENT-REQUIRED");
    if (!reqHeader) return { requiresPayment: true };

    try {
      const reqs = JSON.parse(Buffer.from(reqHeader, "base64").toString("utf8"));
      const first = Array.isArray(reqs.accepts) ? reqs.accepts[0] : reqs;
      return {
        requiresPayment: true,
        amount: first.maxAmountRequired,
        asset: first.asset,
        network: first.network,
        payTo: first.payTo,
      };
    } catch {
      return { requiresPayment: true };
    }
  }
}

/**
 * Create a payment client
 */
export function createPaymentClient(config: PaymentClientConfig): PaymentClient {
  return new PaymentClient(config);
}
