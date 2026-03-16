/**
 * Payment Constants
 *
 * x402 supports ANY ERC-20 token via Permit2 + EIP-3009 (Transfer with Authorization).
 * USDC is the default, but you can use EURC, or pass any ERC-20 token address.
 * See: https://x402.org/
 */

// ---------------------------------------------------------------------------
// Permit2 — canonical address, same on all EVM chains
// Used by x402 to authorize transfers of ANY ERC-20 token.
// ---------------------------------------------------------------------------
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

// ---------------------------------------------------------------------------
// USDC addresses
// ---------------------------------------------------------------------------
/** USDC on Base mainnet */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** USDC on Ethereum mainnet */
export const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;

/** USDC on Polygon */
export const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as const;

/** USDC on Arbitrum */
export const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;

/** USDC on Optimism */
export const USDC_OPTIMISM = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as const;

// ---------------------------------------------------------------------------
// EURC addresses (Circle's Euro stablecoin)
// ---------------------------------------------------------------------------
/** EURC on Base mainnet */
export const EURC_BASE = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42" as const;

/** EURC on Ethereum mainnet */
export const EURC_ETH = "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c" as const;

// ---------------------------------------------------------------------------
// Default token addresses per network (USDC)
// Any ERC-20 address can be passed via the `asset` config field instead.
// ---------------------------------------------------------------------------
export const NETWORK_USDC: Record<string, `0x${string}`> = {
  "eip155:1": USDC_ETH,
  "eip155:8453": USDC_BASE,
  "eip155:137": USDC_POLYGON,
  "eip155:42161": USDC_ARBITRUM,
  "eip155:10": USDC_OPTIMISM,
};

export const NETWORK_EURC: Record<string, `0x${string}`> = {
  "eip155:1": EURC_ETH,
  "eip155:8453": EURC_BASE,
};

/** Default network (Base mainnet) */
export const DEFAULT_NETWORK = "eip155:8453";

/** Default max auto-pay amount: 10 USDC (10,000,000 base units, 6 decimals) */
export const DEFAULT_MAX_AMOUNT = "10000000";

/** Default payment timeout: 5 minutes */
export const DEFAULT_TIMEOUT_SECONDS = 300;

/** ERC-20 ABI for balance checks (works with any ERC-20 token) */
export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/** Base mainnet RPC */
export const BASE_RPC = "https://mainnet.base.org";

/** Default RPC per CAIP-2 network */
export const NETWORK_RPC: Record<string, string> = {
  "eip155:1": "https://eth.llamarpc.com",
  "eip155:8453": BASE_RPC,
  "eip155:137": "https://polygon-rpc.com",
  "eip155:42161": "https://arb1.arbitrum.io/rpc",
  "eip155:10": "https://mainnet.optimism.io",
};
