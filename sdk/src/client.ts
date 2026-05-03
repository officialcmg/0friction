import type { ZeroFrictionConfig } from "./types.js";
import { createQuoteModule } from "./quote.js";
import { createIntentModule } from "./intent.js";
import { createJobsModule } from "./jobs.js";

/**
 * Default testnet configuration.
 * Uses the deployed 0friction solver on Base Sepolia.
 */
export const TESTNET_CONFIG = {
  solverUrl: "https://zerofriction-solver.onrender.com",
  chainId: 84532,
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
  solver: "0xB9a33C169d1360E6AdFf7266797f85467856bCc2" as `0x${string}`,
} satisfies ZeroFrictionConfig;

/**
 * The 0friction client — your entry point to cross-chain AI compute.
 *
 * No configuration needed for testnet — just call `createClient()` with no args.
 *
 * @example
 * ```ts
 * import { createClient } from "@0friction/sdk";
 *
 * // Testnet (Base Sepolia) — zero config
 * const client = createClient();
 *
 * // 1. Get a price quote
 * const quote = await client.quote.get({
 *   model: "qwen/qwen-2.5-7b-instruct",
 *   prompt: "Hello!",
 * });
 *
 * // 2. Build intent (sign this with EIP-712 in your wallet)
 * const intent = client.intent.build({ quote, owner, requestPayload, nonce: "1" });
 *
 * // 3. Submit signed package → get AI response
 * const result = await client.intent.submit({ intent, intentSignature, permit, permitSignature, ... });
 * console.log(result.response);
 * ```
 */
export function createClient(config?: Partial<ZeroFrictionConfig>) {
  const resolved: ZeroFrictionConfig = {
    ...TESTNET_CONFIG,
    ...config,
    // Strip trailing slash
    solverUrl: (config?.solverUrl ?? TESTNET_CONFIG.solverUrl).replace(/\/+$/, ""),
  };

  return {
    config: resolved,
    quote: createQuoteModule(resolved),
    intent: createIntentModule(resolved),
    jobs: createJobsModule(resolved),
  };
}

export type ZeroFrictionClient = ReturnType<typeof createClient>;
