import { v4 as uuidv4 } from "uuid";

// ─── Types ───────────────────────────────────────────────────

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

export interface StoredJob {
  jobId: string;
  status: JobStatus;
  quoteId: string;
  owner: string;
  model: string;
  maxUsdc: string;
  response?: string;
  chargedUsdc?: string;
  settlementTxHash?: string;
  computeResponseId?: string;
  intentHash?: string;
  promptHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredQuote {
  quoteId: string;
  model: string;
  provider: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  maxChargeUsdc: string;
  maxChargeUsdcAtomic: string;
  expiresAt: number;
  signature: string;
  used: boolean;
}

// ─── In-Memory Store ─────────────────────────────────────────

const quotes = new Map<string, StoredQuote>();
const jobs = new Map<string, StoredJob>();

// ─── Quote Store ─────────────────────────────────────────────

export function storeQuote(quote: StoredQuote): void {
  quotes.set(quote.quoteId, quote);
}

export function getQuote(quoteId: string): StoredQuote | undefined {
  const quote = quotes.get(quoteId);
  if (!quote) return undefined;

  // Check expiry
  if (quote.expiresAt < Math.floor(Date.now() / 1000)) {
    quotes.delete(quoteId);
    return undefined;
  }

  return quote;
}

export function markQuoteUsed(quoteId: string): boolean {
  const quote = quotes.get(quoteId);
  if (!quote || quote.used) return false;
  quote.used = true;
  return true;
}

// ─── Job Store ───────────────────────────────────────────────

export function createJob(params: {
  quoteId: string;
  owner: string;
  model: string;
  maxUsdc: string;
  intentHash?: string;
  promptHash?: string;
}): StoredJob {
  const now = Math.floor(Date.now() / 1000);
  const job: StoredJob = {
    jobId: `job_${uuidv4().slice(0, 8)}`,
    status: "RECEIVED",
    quoteId: params.quoteId,
    owner: params.owner,
    model: params.model,
    maxUsdc: params.maxUsdc,
    intentHash: params.intentHash,
    promptHash: params.promptHash,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.jobId, job);
  return job;
}

export function getJob(jobId: string): StoredJob | undefined {
  return jobs.get(jobId);
}

export function updateJob(jobId: string, updates: Partial<StoredJob>): StoredJob | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;

  Object.assign(job, updates, { updatedAt: Math.floor(Date.now() / 1000) });
  return job;
}
