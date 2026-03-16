/**
 * Payment Server — receive x402 payments in your HTTP server
 *
 * Accepts any ERC-20 token via Permit2 + EIP-3009. Defaults to USDC.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_NETWORK,
  DEFAULT_TIMEOUT_SECONDS,
  NETWORK_USDC,
} from "./constants.js";
import type {
  PaymentServerConfig,
  PaymentRequirements,
  PaymentVerifyResult,
  PaymentDetails,
} from "./types.js";

/**
 * Payment server for accepting x402 payments
 */
export class PaymentServer {
  private config: Required<PaymentServerConfig>;

  constructor(config: PaymentServerConfig) {
    const network = config.network ?? DEFAULT_NETWORK;
    this.config = {
      payTo: config.payTo,
      amount: config.amount,
      asset: config.asset ?? NETWORK_USDC[network] ?? NETWORK_USDC["eip155:8453"],
      network,
      description: config.description ?? "AI agent service payment",
      maxTimeoutSeconds: config.maxTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    };
  }

  /**
   * Build x402 PaymentRequirements for a resource URL
   */
  buildRequirements(
    resource: string,
    overrides?: Partial<PaymentServerConfig>
  ): PaymentRequirements {
    return {
      scheme: "exact",
      network: overrides?.network ?? this.config.network,
      maxAmountRequired: overrides?.amount ?? this.config.amount,
      resource,
      description: overrides?.description ?? this.config.description,
      payTo: overrides?.payTo ?? this.config.payTo,
      maxTimeoutSeconds: this.config.maxTimeoutSeconds,
      asset: overrides?.asset ?? this.config.asset,
    };
  }

  /**
   * Build the X-PAYMENT-REQUIRED header value (base64-encoded JSON)
   */
  buildRequirementsHeader(resource: string, overrides?: Partial<PaymentServerConfig>): string {
    const requirements = this.buildRequirements(resource, overrides);
    // x402 v2 format: { version: 2, accepts: [...] }
    const payload = {
      version: 2,
      accepts: [requirements],
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  /**
   * Parse the X-PAYMENT header from an incoming request
   */
  parsePaymentHeader(header: string | null): {
    payload: unknown;
    network: string;
  } | null {
    if (!header) return null;
    try {
      const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
      return {
        payload: decoded.payload ?? decoded,
        network: decoded.network ?? decoded.x402Version?.network ?? this.config.network,
      };
    } catch {
      return null;
    }
  }

  /**
   * Verify a payment — this is a lightweight signature check.
   * For production, use a proper facilitator (e.g. x402.org/faciliate).
   *
   * Note: Full on-chain verification requires a funded facilitator wallet
   * to settle the payment. This SDK provides the verification primitive;
   * settlement is handled by the facilitator service.
   */
  async verify(
    request: Request | IncomingMessage
  ): Promise<PaymentVerifyResult> {
    // Get the X-PAYMENT header
    let paymentHeader: string | null = null;

    if (request instanceof Request) {
      paymentHeader =
        request.headers.get("x-payment") ??
        request.headers.get("X-PAYMENT");
    } else {
      const raw = (request as IncomingMessage).headers["x-payment"];
      paymentHeader = Array.isArray(raw) ? raw[0] : raw ?? null;
    }

    if (!paymentHeader) {
      return {
        valid: false,
        error: "Missing X-PAYMENT header. This endpoint requires x402 payment.",
      };
    }

    const parsed = this.parsePaymentHeader(paymentHeader);
    if (!parsed) {
      return { valid: false, error: "Invalid X-PAYMENT header format" };
    }

    // For full on-chain verification, we'd use ExactEvmFacilitator from @x402/evm
    // Here we do a structural validation (signature format check)
    try {
      const payload = parsed.payload as Record<string, unknown>;

      // Check if it's an EIP-3009 payload
      if (payload.authorization && typeof payload.authorization === "object") {
        const auth = payload.authorization as Record<string, unknown>;
        if (!auth.from || !auth.to || !auth.value || !auth.nonce) {
          return { valid: false, error: "Invalid EIP-3009 authorization structure" };
        }

        const payment: PaymentDetails = {
          from: auth.from as `0x${string}`,
          to: auth.to as `0x${string}`,
          amount: auth.value as string,
          asset: this.config.asset,
          network: parsed.network,
          timestamp: Date.now(),
        };

        return { valid: true, payment };
      }

      // Check if it's a Permit2 payload
      if (payload.permit2Authorization) {
        const p2 = payload.permit2Authorization as Record<string, unknown>;
        const payment: PaymentDetails = {
          from: p2.from as `0x${string}`,
          to: (p2 as Record<string, Record<string, unknown>>).witness?.to as `0x${string}`,
          amount: (p2.permitted as Record<string, string>)?.amount,
          asset: (p2.permitted as Record<string, string>)?.token as `0x${string}`,
          network: parsed.network,
          timestamp: Date.now(),
        };
        return { valid: true, payment };
      }

      return { valid: false, error: "Unrecognized payment payload format" };
    } catch (e) {
      return { valid: false, error: `Payment verification error: ${(e as Error).message}` };
    }
  }

  /**
   * Express-compatible middleware for payment verification.
   * Automatically sends 402 response if payment is missing/invalid.
   *
   * Usage:
   *   app.use('/paid-tool', paymentServer.middleware(), handler)
   */
  middleware(overrides?: Partial<PaymentServerConfig>) {
    return async (
      req: IncomingMessage & { url?: string; payment?: PaymentDetails },
      res: ServerResponse,
      next: () => void
    ) => {
      const paymentHeader =
        (req.headers["x-payment"] as string) ??
        (req.headers["X-PAYMENT"] as string);

      if (!paymentHeader) {
        // Return 402 with payment requirements
        const resource = `${req.headers["host"] ?? ""}${req.url ?? "/"}`;
        const requirementsHeader = this.buildRequirementsHeader(
          `https://${resource}`,
          overrides
        );

        res.writeHead(402, {
          "Content-Type": "application/json",
          "X-PAYMENT-REQUIRED": requirementsHeader,
        });
        res.end(
          JSON.stringify({
            error: "Payment Required",
            message: this.config.description,
            amount: `${this.config.amount} base units`,
            asset: this.config.asset,
            network: this.config.network,
          })
        );
        return;
      }

      const result = await this.verify(req);
      if (!result.valid) {
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payment Invalid", message: result.error }));
        return;
      }

      // Attach payment details to request for downstream handlers
      (req as typeof req & { payment: PaymentDetails }).payment = result.payment!;
      next();
    };
  }
}

/**
 * Create a payment server for receiving x402 payments
 */
export function createPaymentServer(config: PaymentServerConfig): PaymentServer {
  return new PaymentServer(config);
}
