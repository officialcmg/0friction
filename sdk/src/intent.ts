import type {
  ZeroFrictionConfig,
  ComputeIntent,
  IntentSubmission,
  IntentSubmitResponse,
  Quote,
  RequestPayload,
} from "./types.js";
import { hashPayload } from "./hash.js";
import {
  QuoteExpiredError,
  RateLimitedError,
  RetryableNetworkError,
  ZeroFrictionError,
} from "./errors.js";

/** Intent module — builds intent payloads and submits signed packages to the solver */
export function createIntentModule(config: ZeroFrictionConfig) {
  return {
    /**
     * Build a ComputeIntent payload from a quote and request.
     * The app then signs this with EIP-712 using their wallet.
     *
     * @example
     * ```ts
     * const intent = client.intent.build({
     *   quote,
     *   owner: userAddress,
     *   requestPayload: { model: "qwen3.6-plus", messages },
     *   nonce: "1",
     * });
     * ```
     */
    build(params: {
      quote: Quote;
      owner: `0x${string}`;
      requestPayload: RequestPayload;
      nonce: string;
    }): ComputeIntent {
      const promptHash = hashPayload(params.requestPayload);

      return {
        owner: params.owner,
        solver: config.solver,
        chainId: config.chainId,
        token: config.token,
        model: params.quote.model,
        promptHash,
        quoteId: params.quote.quoteId,
        maxUsdc: params.quote.maxChargeUsdc,
        deadline: params.quote.expiresAt,
        nonce: params.nonce,
      };
    },

    /**
     * Submit a signed intent + permit package to the solver for execution.
     *
     * @example
     * ```ts
     * const result = await client.intent.submit({
     *   intent,
     *   intentSignature,
     *   permit,
     *   permitSignature,
     *   requestPayload: { model: "qwen3.6-plus", messages },
     *   quoteId: quote.quoteId,
     * });
     * console.log(result.response);
     * ```
     */
    async submit(params: IntentSubmission): Promise<IntentSubmitResponse> {
      // Client-side expiry check
      if (params.intent.deadline < Math.floor(Date.now() / 1000)) {
        throw new QuoteExpiredError(params.quoteId, params.intent.deadline);
      }

      const res = await fetch(`${config.solverUrl}/v1/intent/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }).catch((err) => {
        throw new RetryableNetworkError(err.message);
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        throw new RateLimitedError(retryAfter ? parseInt(retryAfter) * 1000 : undefined);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "unknown error");
        throw new ZeroFrictionError(`Intent submit failed (${res.status}): ${body}`);
      }

      return res.json();
    },
  };
}
