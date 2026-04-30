// @0friction/sdk — Cross-chain AI compute via 0G
// https://github.com/your-repo/0friction

// Client
export { createClient, type ZeroFrictionClient } from "./client.js";

// Types
export type {
  ZeroFrictionConfig,
  Quote,
  QuoteRequest,
  ComputeIntent,
  Permit,
  RequestPayload,
  IntentSubmission,
  IntentSubmitResponse,
  Job,
  JobStatus,
  AuditBundle,
} from "./types.js";

// Errors
export {
  ZeroFrictionError,
  QuoteExpiredError,
  BudgetExceededError,
  RateLimitedError,
  ProviderUnavailableError,
  SettlementFailedError,
  RetryableNetworkError,
} from "./errors.js";

// Signing helpers (for app-layer use)
export {
  COMPUTE_INTENT_TYPES,
  PERMIT_TYPES,
  buildIntentDomain,
  buildPermitDomain,
} from "./constants.js";

// Hashing
export { hashPayload } from "./hash.js";
