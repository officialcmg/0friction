/**
 * 0friction CLI Agent
 *
 * A minimal interactive chatbot that uses @0friction/sdk to execute
 * AI compute on 0G, paid with USDC on Base Sepolia via gasless permits.
 *
 * Usage:
 *   cd examples
 *   npm install
 *   cp .env.example .env   # fill in your private key
 *   npx tsx cli-agent.ts
 */

import "dotenv/config";
import * as readline from "readline";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// ─── Config ──────────────────────────────────────────────────

const SOLVER_URL = process.env.SOLVER_URL || "http://localhost:3001";
const PRIVATE_KEY = process.env.USER_PRIVATE_KEY as Hex;
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "84532");
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`;
const SOLVER_ADDRESS = (process.env.SOLVER_ADDRESS || "0x0000000000000000000000000000000000000001") as `0x${string}`;
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

if (!PRIVATE_KEY) {
  console.error("❌ Set USER_PRIVATE_KEY in .env");
  process.exit(1);
}

// ─── EIP-712 Type Definitions ────────────────────────────────

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

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const ERC20_PERMIT_ABI = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address owner) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

// ─── Setup ───────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC_URL),
});

// ─── Helpers ─────────────────────────────────────────────────

function hashPayload(payload: { model: string; messages: Array<{ role: string; content: string }> }): Hex {
  const { keccak256, toBytes } = await_import();
  const canonical = JSON.stringify({
    model: payload.model,
    messages: payload.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return keccak256(toBytes(canonical));
}

// Lazy import for viem hash functions (top-level await workaround)
function await_import() {
  // These are re-exported from viem, using inline
  const { keccak256, toBytes } = require("viem") as typeof import("viem");
  return { keccak256, toBytes };
}

let intentNonce = 0;

async function chat(userMessage: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  const { keccak256, toBytes } = await_import();

  // 1. Add user message to history
  messages.push({ role: "user", content: userMessage });

  // 2. Get quote from solver
  console.log("  📋 Getting quote...");
  const quoteRes = await fetch(`${SOLVER_URL}/v1/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "qwen3.6-plus", prompt: userMessage }),
  });

  if (!quoteRes.ok) {
    throw new Error(`Quote failed: ${await quoteRes.text()}`);
  }

  const quote = await quoteRes.json();
  console.log(`  💰 Max cost: $${quote.maxChargeUsdc} USDC (expires in ${quote.expiresAt - Math.floor(Date.now() / 1000)}s)`);

  // 3. Build request payload and compute prompt hash
  const requestPayload = { model: "qwen3.6-plus", messages };
  const canonical = JSON.stringify({
    model: requestPayload.model,
    messages: requestPayload.messages.map((m: any) => ({ role: m.role, content: m.content })),
  });
  const promptHash = keccak256(toBytes(canonical));

  // 4. Build intent
  const intent = {
    owner: account.address,
    solver: SOLVER_ADDRESS,
    chainId: CHAIN_ID,
    token: USDC_ADDRESS,
    model: "qwen3.6-plus",
    promptHash,
    quoteId: quote.quoteId,
    maxUsdc: quote.maxChargeUsdc,
    deadline: quote.expiresAt,
    nonce: String(intentNonce++),
  };

  // 5. Sign intent (EIP-712)
  console.log("  🔐 Signing intent...");
  const intentDomain = {
    name: "0friction" as const,
    version: "1" as const,
    chainId: BigInt(CHAIN_ID),
    verifyingContract: "0x0000000000000000000000000000000000000001" as `0x${string}`,
  };

  const intentSignature = await walletClient.signTypedData({
    domain: intentDomain,
    types: COMPUTE_INTENT_TYPES,
    primaryType: "ComputeIntent",
    message: {
      ...intent,
      chainId: BigInt(intent.chainId),
      deadline: BigInt(intent.deadline),
      nonce: BigInt(intent.nonce),
    },
  });

  // 6. Build and sign permit (EIP-2612)
  console.log("  🔐 Signing USDC permit...");

  // Read USDC domain fields from chain
  let usdcName = "USD Coin";
  let usdcVersion = "2";
  let permitNonce = 0n;

  try {
    [usdcName, usdcVersion, permitNonce] = await Promise.all([
      publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_PERMIT_ABI, functionName: "name" }),
      publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_PERMIT_ABI, functionName: "version" }),
      publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_PERMIT_ABI, functionName: "nonces", args: [account.address] }),
    ]);
  } catch (err: any) {
    console.log(`  ⚠️  Could not read USDC on-chain (${err.message}), using defaults`);
  }

  const permit = {
    owner: account.address,
    spender: SOLVER_ADDRESS,
    value: quote.maxChargeUsdcAtomic,
    nonce: String(permitNonce),
    deadline: quote.expiresAt,
  };

  const permitDomain = {
    name: usdcName,
    version: usdcVersion,
    chainId: BigInt(CHAIN_ID),
    verifyingContract: USDC_ADDRESS,
  };

  const permitSignature = await walletClient.signTypedData({
    domain: permitDomain,
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: {
      owner: permit.owner,
      spender: permit.spender,
      value: BigInt(permit.value),
      nonce: BigInt(permit.nonce),
      deadline: BigInt(permit.deadline),
    },
  });

  // 7. Submit to solver
  console.log("  ⚡ Submitting to solver...");
  const submitRes = await fetch(`${SOLVER_URL}/v1/intent/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent,
      intentSignature,
      permit,
      permitSignature,
      requestPayload,
      quoteId: quote.quoteId,
    }),
  });

  if (!submitRes.ok) {
    throw new Error(`Submit failed: ${await submitRes.text()}`);
  }

  const result = await submitRes.json();

  // 8. Show result
  console.log(`  ✅ Job ${result.jobId} — ${result.status}`);
  if (result.auditBundle?.chargedUsdc) {
    console.log(`  💳 Charged: $${result.auditBundle.chargedUsdc} USDC`);
  }
  if (result.auditBundle?.settlementTxHash) {
    console.log(`  🔗 Settlement: ${result.auditBundle.settlementTxHash}`);
  }

  const aiResponse = result.response || "[No response]";
  messages.push({ role: "assistant", content: aiResponse });

  return aiResponse;
}

// ─── REPL ────────────────────────────────────────────────────

async function main() {
  console.log(`
╔══════════════════════════════════════════════════╗
║        0friction CLI Agent                       ║
║  Cross-chain AI compute via 0G · Paid in USDC   ║
╚══════════════════════════════════════════════════╝

  Wallet:  ${account.address}
  Chain:   Base Sepolia (${CHAIN_ID})
  Solver:  ${SOLVER_URL}
  Token:   USDC (${USDC_ADDRESS.slice(0, 10)}...)
  `);

  // Check USDC balance
  try {
    const balance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_PERMIT_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    const decimals = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_PERMIT_ABI,
      functionName: "decimals",
    });
    const formatted = Number(balance) / 10 ** Number(decimals);
    console.log(`  Balance: ${formatted} USDC\n`);
  } catch {
    console.log("  Balance: (could not read)\n");
  }

  console.log('  Type your message and press Enter. Type "exit" to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const messages: Array<{ role: string; content: string }> = [];

  const prompt = () => {
    rl.question("You > ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed.toLowerCase() === "exit") {
        console.log("\n👋 Goodbye!");
        rl.close();
        process.exit(0);
      }

      try {
        const response = await chat(trimmed, messages);
        console.log(`\n  AI > ${response}\n`);
      } catch (err: any) {
        console.error(`\n  ❌ Error: ${err.message}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main();
