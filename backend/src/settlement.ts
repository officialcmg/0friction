import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config } from "./config.js";

const USDC_ABI = parseAbi([
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function nonces(address owner) view returns (uint256)",
]);

/**
 * Execute USDC settlement on the home chain (Base Sepolia).
 *
 * 1. Call permit() using the user's off-chain signature to set allowance
 * 2. Call transferFrom() to pull USDC from user to solver
 *
 * Returns the settlement transaction hash.
 */
export async function settlePayment(params: {
  permit: {
    owner: `0x${string}`;
    spender: `0x${string}`;
    value: string;
    deadline: number;
  };
  permitSignature: `0x${string}`;
  actualChargeAtomic: bigint;
}): Promise<{ txHash: string }> {
  if (!config.homeChainPrivateKey) {
    console.log("⚠️  No HOME_CHAIN_PRIVATE_KEY — skipping settlement");
    return { txHash: `mock_settle_${Date.now()}` };
  }

  const account = privateKeyToAccount(config.homeChainPrivateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.homeChainRpc),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(config.homeChainRpc),
  });

  // Split signature into v, r, s
  const sig = params.permitSignature;
  const r = `0x${sig.slice(2, 66)}` as `0x${string}`;
  const s = `0x${sig.slice(66, 130)}` as `0x${string}`;
  const v = parseInt(sig.slice(130, 132), 16);

  // Step 1: Execute permit
  console.log(`📝 Executing permit for ${params.permit.owner}...`);
  try {
    const permitTx = await walletClient.writeContract({
      address: config.usdcAddress,
      abi: USDC_ABI,
      functionName: "permit",
      args: [
        params.permit.owner,
        params.permit.spender,
        BigInt(params.permit.value),
        BigInt(params.permit.deadline),
        v,
        r,
        s,
      ],
    });

    await publicClient.waitForTransactionReceipt({ hash: permitTx });
    console.log(`✅ Permit executed: ${permitTx}`);
  } catch (err: any) {
    // Permit may already be used or allowance already set — check allowance
    console.warn(`⚠️  Permit call failed (may already be set): ${err.message}`);
  }

  // Step 2: Execute transferFrom
  console.log(`💰 Pulling ${params.actualChargeAtomic} USDC atomic units...`);
  const transferTx = await walletClient.writeContract({
    address: config.usdcAddress,
    abi: USDC_ABI,
    functionName: "transferFrom",
    args: [
      params.permit.owner,
      params.permit.spender, // solver address
      params.actualChargeAtomic,
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: transferTx });
  console.log(`✅ Settlement complete: ${transferTx} (block ${receipt.blockNumber})`);

  return { txHash: transferTx };
}
