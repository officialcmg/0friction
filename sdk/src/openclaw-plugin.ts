/**
 * 0friction OpenClaw Plugin
 *
 * A thin wrapper that makes @0friction/sdk usable as an OpenClaw tool,
 * allowing any OpenClaw-based agent to use 0G Compute through 0friction
 * without additional setup.
 *
 * This strengthens track fit for the "Best Agent Framework, Tooling & Core
 * Extensions" category by making 0friction composable with existing agent
 * frameworks.
 */

import { createClient } from "./client.js";
import { hashPayload } from "./hash.js";
import type {
  ZeroFrictionConfig,
  ComputeIntent,
  Permit,
  RequestPayload,
} from "./types.js";

export interface OpenClawToolContext {
  config: {
    zeroFriction: ZeroFrictionConfig;
  };
  wallet: {
    address: `0x${string}`;
    signTypedData: (params: any) => Promise<`0x${string}`>;
  };
}

export interface OpenClawToolInput {
  prompt: string;
  model?: string;
  maxUsdc?: string;
}

/**
 * OpenClaw-compatible tool definition for 0friction compute.
 *
 * @example
 * ```ts
 * import { zeroFrictionTool } from "@0friction/sdk/openclaw";
 *
 * const agent = createOpenClawAgent({
 *   tools: [zeroFrictionTool],
 *   config: {
 *     zeroFriction: {
 *       solverUrl: "http://localhost:3001",
 *       chainId: 84532,
 *       token: USDC_ADDRESS,
 *       solver: SOLVER_ADDRESS,
 *     },
 *   },
 * });
 * ```
 */
export const zeroFrictionTool = {
  name: "0friction-compute",
  description:
    "Execute AI inference on 0G Compute Network. Users pay with USDC on their home chain via gasless permit signatures. No A0GI tokens or bridging required.",

  parameters: {
    prompt: { type: "string", description: "The user's message or prompt" },
    model: { type: "string", description: "AI model (default: qwen3.6-plus)", optional: true },
  },

  async execute(
    context: OpenClawToolContext,
    input: OpenClawToolInput,
  ): Promise<string> {
    const client = createClient(context.config.zeroFriction);
    const model = input.model || "qwen3.6-plus";

    // 1. Get quote
    const quote = await client.quote.get({ model, prompt: input.prompt });

    // 2. Build intent
    const messages = [{ role: "user", content: input.prompt }];
    const requestPayload: RequestPayload = { model, messages };
    const promptHash = hashPayload(requestPayload);

    const intent: ComputeIntent = {
      owner: context.wallet.address,
      solver: context.config.zeroFriction.solver,
      chainId: context.config.zeroFriction.chainId,
      token: context.config.zeroFriction.token,
      model,
      promptHash,
      quoteId: quote.quoteId,
      maxUsdc: quote.maxChargeUsdc,
      deadline: quote.expiresAt,
      nonce: String(Date.now()),
    };

    // 3. Sign intent
    const intentSignature = await context.wallet.signTypedData({
      domain: {
        name: "0friction",
        version: "1",
        chainId: BigInt(intent.chainId),
        verifyingContract: "0x0000000000000000000000000000000000000001",
      },
      types: {
        ComputeIntent: [
          { name: "owner", type: "address" },
          { name: "solver", type: "address" },
          { name: "chainId", type: "uint256" },
          { name: "token", type: "address" },
          { name: "model", type: "string" },
          { name: "promptHash", type: "bytes32" },
          { name: "quoteId", type: "string" },
          { name: "maxUsdc", type: "string" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      primaryType: "ComputeIntent",
      message: intent,
    });

    // 4. Build and sign permit
    const permit: Permit = {
      owner: context.wallet.address,
      spender: context.config.zeroFriction.solver,
      value: quote.maxChargeUsdcAtomic,
      nonce: String(Date.now()),
      deadline: quote.expiresAt,
    };

    const permitSignature = await context.wallet.signTypedData({
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: BigInt(intent.chainId),
        verifyingContract: context.config.zeroFriction.token,
      },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: permit,
    });

    // 5. Submit
    const result = await client.intent.submit({
      intent,
      intentSignature,
      permit,
      permitSignature,
      requestPayload,
      quoteId: quote.quoteId,
    });

    return result.response || "[No response]";
  },
};
