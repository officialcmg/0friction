/** Base error for all 0friction SDK errors */
export class ZeroFrictionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZeroFrictionError";
  }
}

/** The quote has expired (past its TTL) */
export class QuoteExpiredError extends ZeroFrictionError {
  constructor(quoteId: string, expiresAt: number) {
    super(`Quote ${quoteId} expired at ${new Date(expiresAt * 1000).toISOString()}`);
    this.name = "QuoteExpiredError";
  }
}

/** The request would exceed the user's budget */
export class BudgetExceededError extends ZeroFrictionError {
  constructor(requested: string, max: string) {
    super(`Requested ${requested} USDC exceeds max budget of ${max} USDC`);
    this.name = "BudgetExceededError";
  }
}

/** The solver is rate-limiting requests */
export class RateLimitedError extends ZeroFrictionError {
  public retryAfterMs?: number;

  constructor(retryAfterMs?: number) {
    super(`Rate limited${retryAfterMs ? `. Retry after ${retryAfterMs}ms` : ""}`);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** The 0G compute provider is unavailable */
export class ProviderUnavailableError extends ZeroFrictionError {
  constructor(provider?: string) {
    super(`Provider ${provider ?? "unknown"} is currently unavailable`);
    this.name = "ProviderUnavailableError";
  }
}

/** Payment settlement failed on the home chain */
export class SettlementFailedError extends ZeroFrictionError {
  constructor(reason: string) {
    super(`Settlement failed: ${reason}`);
    this.name = "SettlementFailedError";
  }
}

/** Transient network error — safe to retry */
export class RetryableNetworkError extends ZeroFrictionError {
  constructor(message: string) {
    super(`Network error (retryable): ${message}`);
    this.name = "RetryableNetworkError";
  }
}
