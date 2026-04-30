import type { ZeroFrictionConfig } from "./types.js";
import { createQuoteModule } from "./quote.js";
import { createIntentModule } from "./intent.js";
import { createJobsModule } from "./jobs.js";

/**
 * The 0friction client — your entry point to cross-chain AI compute.
 *
 * @example
 * ```ts
 * import { createClient } from "@0friction/sdk";
 *
 * const client = createClient({
 *   solverUrl: "https://solver.0friction.xyz",
 *   chainId: 84532,  // Base Sepolia
 *   token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
 *   solver: "0x...",
 * });
 *
 * // 1. Get a quote
 * const quote = await client.quote.get({ model: "qwen3.6-plus", prompt: "Hello" });
 *
 * // 2. Build intent (app signs this with EIP-712)
 * const intent = client.intent.build({ quote, owner, requestPayload, nonce: "1" });
 *
 * // 3. Submit signed package
 * const result = await client.intent.submit({ intent, intentSignature, ... });
 * ```
 */
export function createClient(config: ZeroFrictionConfig) {
  // Validate config
  if (!config.solverUrl) throw new Error("solverUrl is required");
  if (!config.chainId) throw new Error("chainId is required");
  if (!config.token) throw new Error("token (USDC address) is required");
  if (!config.solver) throw new Error("solver address is required");

  // Strip trailing slash from solver URL
  const normalizedConfig: ZeroFrictionConfig = {
    ...config,
    solverUrl: config.solverUrl.replace(/\/+$/, ""),
  };

  return {
    config: normalizedConfig,
    quote: createQuoteModule(normalizedConfig),
    intent: createIntentModule(normalizedConfig),
    jobs: createJobsModule(normalizedConfig),
  };
}

export type ZeroFrictionClient = ReturnType<typeof createClient>;
