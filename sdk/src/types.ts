// ─── Core Config ─────────────────────────────────────────────

/** Configuration for creating a 0friction client. All fields have testnet defaults. */
export interface ZeroFrictionConfig {
  /** URL of the 0friction solver backend. Defaults to the hosted testnet solver. */
  solverUrl: string;
  /** Home chain ID. Defaults to 84532 (Base Sepolia). */
  chainId: number;
  /** USDC contract address on the home chain. Defaults to USDC on Base Sepolia. */
  token: `0x${string}`;
  /** Solver wallet address (receives USDC). Defaults to testnet solver. */
  solver: `0x${string}`;
}

// ─── Quote Types ─────────────────────────────────────────────

export interface QuoteRequest {
  /** AI model to use (e.g. "qwen3.6-plus") */
  model: string;
  /** The user's prompt (used for token estimation) */
  prompt: string;
}

export interface Quote {
  quoteId: string;
  model: string;
  provider: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  /** Maximum charge in USDC (decimal string, e.g. "0.0012") */
  maxChargeUsdc: string;
  /** Maximum charge in atomic USDC units (6 decimals) */
  maxChargeUsdcAtomic: string;
  /** Unix timestamp when this quote expires */
  expiresAt: number;
  /** Solver's signature over the quote */
  signature: string;
}

// ─── Intent Types ────────────────────────────────────────────

/** EIP-712 ComputeIntent — user's authorization for a compute job */
export interface ComputeIntent {
  owner: `0x${string}`;
  solver: `0x${string}`;
  chainId: number;
  token: `0x${string}`;
  model: string;
  promptHash: `0x${string}`;
  quoteId: string;
  maxUsdc: string;
  deadline: number;
  nonce: string;
}

/** EIP-2612 Permit — user's authorization for USDC spend */
export interface Permit {
  owner: `0x${string}`;
  spender: `0x${string}`;
  value: string;
  nonce: string;
  deadline: number;
}

/** Request payload sent to the AI model */
export interface RequestPayload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxOutputTokens?: number;
}

/** Full submission to the solver */
export interface IntentSubmission {
  intent: ComputeIntent;
  intentSignature: `0x${string}`;
  permit: Permit;
  permitSignature: `0x${string}`;
  requestPayload: RequestPayload;
  quoteId: string;
}

// ─── Job Types ───────────────────────────────────────────────

export type JobStatus =
  | "RECEIVED"
  | "VERIFIED"
  | "EXECUTING"
  | "EXECUTED"
  | "SETTLING"
  | "SETTLED"
  | "FAILED_VERIFICATION"
  | "FAILED_EXECUTION"
  | "FAILED_SETTLEMENT"
  | "FAILED_TIMEOUT";

export interface Job {
  jobId: string;
  status: JobStatus;
  response?: string;
  model?: string;
  chargedUsdc?: string;
  settlementTxHash?: string;
  createdAt: number;
  updatedAt: number;
  auditBundle?: AuditBundle;
}

export interface AuditBundle {
  quoteId: string;
  intentHash: string;
  promptHash: string;
  computeResponseId?: string;
  settlementTxHash?: string;
  chargedUsdc?: string;
  timestamp: number;
}

// ─── Response Wrappers ───────────────────────────────────────

export interface IntentSubmitResponse {
  jobId: string;
  status: JobStatus;
  response?: string;
  auditBundle?: AuditBundle;
}
