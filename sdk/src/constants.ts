/**
 * EIP-712 type definitions and domain helpers for 0friction.
 *
 * These are exported so app-layer code can use them for signing
 * without having to define the types themselves.
 */

/** EIP-712 type definition for ComputeIntent */
export const COMPUTE_INTENT_TYPES = {
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

/** EIP-2612 Permit type definition (standard across all EIP-2612 tokens) */
export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Build the EIP-712 domain for 0friction ComputeIntent signing.
 * The verifyingContract is a sentinel address in v1 (off-chain verification).
 */
export function buildIntentDomain(chainId: number, verifier?: `0x${string}`) {
  return {
    name: "0friction",
    version: "1",
    chainId: BigInt(chainId),
    verifyingContract: verifier ?? ("0x0000000000000000000000000000000000000001" as `0x${string}`),
  };
}

/**
 * Build the EIP-712 domain for USDC permit signing.
 * Domain fields vary by chain — caller should read name() and version() from the USDC contract.
 */
export function buildPermitDomain(
  chainId: number,
  usdcAddress: `0x${string}`,
  usdcName: string = "USD Coin",
  usdcVersion: string = "2",
) {
  return {
    name: usdcName,
    version: usdcVersion,
    chainId: BigInt(chainId),
    verifyingContract: usdcAddress,
  };
}
