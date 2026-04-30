import type { ZeroFrictionConfig, Quote, QuoteRequest } from "./types.js";
import {
  QuoteExpiredError,
  RateLimitedError,
  RetryableNetworkError,
  ZeroFrictionError,
} from "./errors.js";

/** Quote module — fetches and validates price quotes from the solver */
export function createQuoteModule(config: ZeroFrictionConfig) {
  return {
    /**
     * Get a price quote for an AI compute request.
     *
     * @example
     * ```ts
     * const quote = await client.quote.get({
     *   model: "qwen3.6-plus",
     *   prompt: "What is quantum computing?",
     * });
     * console.log(quote.maxChargeUsdc); // "0.0012"
     * ```
     */
    async get(params: QuoteRequest): Promise<Quote> {
      const res = await fetch(`${config.solverUrl}/v1/quote`, {
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
        throw new ZeroFrictionError(`Quote request failed (${res.status}): ${body}`);
      }

      const quote: Quote = await res.json();

      // Client-side expiry check
      if (quote.expiresAt < Math.floor(Date.now() / 1000)) {
        throw new QuoteExpiredError(quote.quoteId, quote.expiresAt);
      }

      return quote;
    },
  };
}
