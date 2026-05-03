/**
 * 0friction SDK — End-to-End Test Script
 *
 * Runs the exact app flow against a solver URL (Render by default):
 *   1) Get quote
 *   2) Build ComputeIntent
 *   3) Sign ComputeIntent (EIP-712)
 *   4) Sign USDC Permit (EIP-2612)
 *   5) Submit signed package through SDK
 *   6) Print response + audit bundle
 *
 * Usage:
 *   TEST_PRIVATE_KEY=0x... npx tsx test-sdk.ts
 *   SOLVER_URL=https://zerofriction-solver.onrender.com TEST_PRIVATE_KEY=0x... npx tsx test-sdk.ts
 */

import {
  createClient,
  TESTNET_CONFIG,
  buildIntentDomain,
  buildPermitDomain,
  COMPUTE_INTENT_TYPES,
  PERMIT_TYPES,
} from "@0friction/sdk";

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// ─── Runtime config ───────────────────────────────────────────
const TEST_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as `0x${string}` | undefined;
const SOLVER_URL = (process.env.SOLVER_URL || TESTNET_CONFIG.solverUrl).replace(/\/+$/, "");

if (!TEST_PRIVATE_KEY) {
  console.error("❌ Missing TEST_PRIVATE_KEY env var");
  console.error("   Example: TEST_PRIVATE_KEY=0xabc... npx tsx test-sdk.ts");
  process.exit(1);
}

const account = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_ADDRESS = account.address;

const USDC_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function name() view returns (string)",
  "function version() view returns (string)",
]);

// ─── Setup chain clients ──────────────────────────────────────
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });

// ─── 0friction SDK client ─────────────────────────────────────
const client = createClient({ solverUrl: SOLVER_URL });

// ─── Helpers ─────────────────────────────────────────────────
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function info(msg: string) { console.log(`  ℹ  ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); }
function section(title: string) { console.log(`\n─── ${title} ${"─".repeat(50 - title.length)}`); }

function short(s: string, n = 22) {
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}

// ─── Main ─────────────────────────────────────────────────────
async function runTest() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  0friction SDK — End-to-End Test          ║");
  console.log("╚══════════════════════════════════════════╝");

  info(`Solver URL: ${SOLVER_URL}`);
  info(`Chain: Base Sepolia (${TESTNET_CONFIG.chainId})`);
  info(`Tester: ${TEST_ADDRESS}`);

  // ── 0. Check USDC balance ──────────────────────────────────
  section("Pre-flight Checks");
  const usdcBalance = await publicClient.readContract({
    address: TESTNET_CONFIG.token,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [TEST_ADDRESS],
  });
  info(`USDC balance: ${formatUnits(usdcBalance, 6)} USDC`);
  if (usdcBalance === 0n) {
    fail("No USDC! Get testnet USDC at https://faucet.circle.com");
    process.exit(1);
  }
  ok("Has USDC");

  // Check solver health
  const health = await fetch(`${SOLVER_URL}/health`).then(r => r.json()).catch(() => null);
  if (!health) {
    fail("Solver unreachable — is the backend running?");
    process.exit(1);
  }
  ok(`Solver healthy: ${JSON.stringify(health)}`);

  // ── 1. Get a quote ─────────────────────────────────────────
  section("Step 1: Get Quote");
  const prompt = "In one sentence, what is 0G Compute Network?";
  info(`Prompt: "${prompt}"`);

  const quote = await client.quote.get({
    model: "qwen/qwen-2.5-7b-instruct",
    prompt,
  });
  ok(`Quote ID: ${quote.quoteId}`);
  ok(`Max charge: ${quote.maxChargeUsdc} USDC (${quote.maxChargeUsdcAtomic} atomic)`);
  ok(`Expires: ${new Date(quote.expiresAt * 1000).toISOString()}`);

  // ── 2. Build intent ────────────────────────────────────────
  section("Step 2: Build ComputeIntent");
  const nonce = String(Math.floor(Date.now() / 1000));
  const requestPayload = {
    model: "qwen/qwen-2.5-7b-instruct",
    messages: [{ role: "user", content: prompt }],
  };

  const intent = client.intent.build({
    quote,
    owner: TEST_ADDRESS,
    requestPayload,
    nonce,
  });
  ok("Intent built");
  info(`Intent: ${JSON.stringify(intent, null, 2)}`);

  // ── 3. Sign intent (EIP-712) ───────────────────────────────
  section("Step 3: Sign ComputeIntent (EIP-712)");
  const intentDomain = buildIntentDomain(TESTNET_CONFIG.chainId);

  const intentSig = await walletClient.signTypedData({
    domain: intentDomain,
    types: COMPUTE_INTENT_TYPES,
    primaryType: "ComputeIntent",
    message: {
      owner: intent.owner,
      solver: intent.solver,
      chainId: BigInt(intent.chainId),
      token: intent.token,
      model: intent.model,
      promptHash: intent.promptHash,
      quoteId: intent.quoteId,
      maxUsdc: intent.maxUsdc,
      deadline: BigInt(intent.deadline),
      nonce: BigInt(intent.nonce),
    },
  });
  ok(`Intent signature: ${short(intentSig)}`);

  // ── 4. Sign USDC Permit (EIP-2612) ────────────────────────
  section("Step 4: Sign USDC Permit (EIP-2612)");

  // Read USDC permit nonce and token metadata on-chain
  const [permitNonce, usdcName, usdcVersion] = await Promise.all([
    publicClient.readContract({ address: TESTNET_CONFIG.token, abi: USDC_ABI, functionName: "nonces", args: [TEST_ADDRESS] }),
    publicClient.readContract({ address: TESTNET_CONFIG.token, abi: USDC_ABI, functionName: "name" }),
    publicClient.readContract({ address: TESTNET_CONFIG.token, abi: USDC_ABI, functionName: "version" }),
  ]);

  info(`USDC name: ${usdcName}, version: ${usdcVersion}, nonce: ${permitNonce}`);

  const permit = {
    owner: TEST_ADDRESS,
    spender: TESTNET_CONFIG.solver,
    value: quote.maxChargeUsdcAtomic,
    nonce: String(permitNonce),
    deadline: quote.expiresAt,
  };

  const permitDomain = buildPermitDomain(
    TESTNET_CONFIG.chainId,
    TESTNET_CONFIG.token,
    usdcName,
    usdcVersion,
  );

  const permitSig = await walletClient.signTypedData({
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
  ok(`Permit signature: ${short(permitSig)}`);

  // ── 5. Submit to solver ────────────────────────────────────
  section("Step 5: Submit to Solver → 0G Compute");
  info("Sending signed package to solver...");

  const result = await client.intent.submit({
    intent,
    intentSignature: intentSig,
    permit,
    permitSignature: permitSig,
    requestPayload,
    quoteId: quote.quoteId,
  });

  ok(`Job ID: ${result.jobId}`);
  ok(`Status: ${result.status}`);

  if (result.status !== "SETTLED") {
    fail(`Expected SETTLED status, got ${result.status}`);
    process.exit(1);
  }

  if ((result.response || "").includes("[Mock")) {
    fail("Received mock response from backend, expected live 0G compute response");
    process.exit(1);
  }

  // ── 6. Print AI response ───────────────────────────────────
  section("Step 6: AI Response");
  console.log("\n  🤖 Response:");
  console.log(`  "${result.response || "[no response]"}"\n`);

  // ── 7. Audit bundle ────────────────────────────────────────
  section("Step 7: Audit Bundle");
  if (result.auditBundle) {
    ok(`Quote ID: ${result.auditBundle.quoteId}`);
    ok(`Intent hash: ${short(result.auditBundle.intentHash || "")}`);
    ok(`Prompt hash: ${short(result.auditBundle.promptHash || "")}`);
    ok(`Settlement tx: ${result.auditBundle.settlementTxHash || "none"}`);
    ok(`Charged: ${result.auditBundle.chargedUsdc || "0"} USDC`);

    if (!result.auditBundle.settlementTxHash || !result.auditBundle.settlementTxHash.startsWith("0x")) {
      fail("Expected real settlement tx hash in audit bundle");
      process.exit(1);
    }
  }

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  ✅ SDK END-TO-END TEST PASSED             ║");
  console.log("╚══════════════════════════════════════════╝\n");
}

runTest().catch(err => {
  fail(`Test failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
