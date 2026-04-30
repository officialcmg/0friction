import { verifyTypedData, keccak256, toBytes } from "viem";

const COMPUTE_INTENT_TYPES = {
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
} as const;

/**
 * Verify that the EIP-712 intent signature was signed by the claimed owner.
 */
export async function verifyIntentSignature(
  intent: {
    owner: string;
    solver: string;
    chainId: number;
    token: string;
    model: string;
    promptHash: string;
    quoteId: string;
    maxUsdc: string;
    deadline: number;
    nonce: string;
  },
  signature: `0x${string}`,
  chainId: number,
): Promise<boolean> {
  try {
    const domain = {
      name: "0friction",
      version: "1",
      chainId: BigInt(chainId),
      verifyingContract: "0x0000000000000000000000000000000000000001" as `0x${string}`,
    };

    const valid = await verifyTypedData({
      address: intent.owner as `0x${string}`,
      domain,
      types: COMPUTE_INTENT_TYPES,
      primaryType: "ComputeIntent",
      message: {
        owner: intent.owner as `0x${string}`,
        solver: intent.solver as `0x${string}`,
        chainId: BigInt(intent.chainId),
        token: intent.token as `0x${string}`,
        model: intent.model,
        promptHash: intent.promptHash as `0x${string}`,
        quoteId: intent.quoteId,
        maxUsdc: intent.maxUsdc,
        deadline: BigInt(intent.deadline),
        nonce: BigInt(intent.nonce),
      },
      signature,
    });

    return valid;
  } catch (err) {
    console.error("Intent signature verification failed:", err);
    return false;
  }
}

/**
 * Verify that the prompt hash matches the actual request payload.
 */
export function verifyPromptHash(
  requestPayload: { model: string; messages: Array<{ role: string; content: string }> },
  claimedHash: string,
): boolean {
  const canonical = JSON.stringify({
    model: requestPayload.model,
    messages: requestPayload.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const computedHash = keccak256(toBytes(canonical));
  return computedHash.toLowerCase() === claimedHash.toLowerCase();
}
