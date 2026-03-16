/**
 * @a3stack/payments
 * x402 payment flows for AI agents — any ERC-20 token via Permit2 + EIP-3009
 */

export { PaymentClient, createPaymentClient } from "./client.js";
export { PaymentServer, createPaymentServer } from "./server.js";
export {
  PERMIT2,
  USDC_BASE,
  USDC_ETH,
  USDC_POLYGON,
  USDC_ARBITRUM,
  USDC_OPTIMISM,
  EURC_BASE,
  EURC_ETH,
  NETWORK_USDC,
  NETWORK_EURC,
  DEFAULT_NETWORK,
  DEFAULT_MAX_AMOUNT,
} from "./constants.js";
export type {
  PaymentClientConfig,
  PaymentServerConfig,
  PaymentDetails,
  PaymentBalance,
  PaymentVerifyResult,
  PaymentRequirements,
  PaymentContext,
} from "./types.js";
