import { ethers } from "ethers";
import { config } from "./config.js";

// ─── Broker State ────────────────────────────────────────────

let broker: any = null;
let solverWallet: ethers.Wallet | null = null;
let solverAddress: string = "";

/**
 * Initialize the 0G Compute Network broker.
 * Uses require() on the CJS build to avoid ESM/tsx dynamic import issues.
 */
export async function initBroker(): Promise<void> {
  if (!config.solverPrivateKey) {
    console.warn("⚠️  No SOLVER_PRIVATE_KEY — broker disabled");
    return;
  }

  try {
    const provider = new ethers.JsonRpcProvider(config.zgRpcUrl);
    solverWallet = new ethers.Wallet(config.solverPrivateKey, provider);
    solverAddress = await solverWallet.getAddress();

    console.log(`🔑 Solver address on 0G: ${solverAddress}`);

    // Load via CJS shim — bypasses tsx ESM dynamic import interception
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createZGComputeNetworkBroker } = require("./zgSdkShim.js");

    broker = await createZGComputeNetworkBroker(solverWallet);
    console.log("✅ 0G Broker initialized");

    // Discover available services
    try {
      const services = await broker.inference.listService();
      console.log(`📋 Found ${services.length} service(s) on 0G`);
      const chatServices = services.filter((s: any) => s.serviceType === "chatbot");
      for (const svc of chatServices) {
        console.log(`   📡 ${svc.model} @ ${svc.providerAddress?.slice(0, 10)}...`);
      }
    } catch (err: any) {
      console.warn(`⚠️  Could not list services: ${err.message}`);
    }
  } catch (err: any) {
    console.error(`❌ Broker init failed: ${err.message}`);
    console.warn("⚠️  Falling back to mock mode");
  }
}

/**
 * Execute AI inference via 0G Compute Network.
 */
export async function executeCompute(
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<{ response: string; computeResponseId?: string }> {
  if (!broker) {
    console.log("🎭 Mock mode — broker not initialized");
    await new Promise((r) => setTimeout(r, 600));
    return {
      response: `[Mock — 0G broker unavailable] ${messages[messages.length - 1]?.content}`,
      computeResponseId: `mock_${Date.now()}`,
    };
  }

  if (config.enableMockFallback) {
    console.log("🎭 Mock mode — ENABLE_MOCK_FALLBACK=true");
    await new Promise((r) => setTimeout(r, 600));
    return {
      response: `[Mock] Message received: "${messages[messages.length - 1]?.content}"`,
      computeResponseId: `mock_${Date.now()}`,
    };
  }

  // Find provider for the requested model
  const services = await broker.inference.listService();
  const service = services.find((s: any) => s.model === model)
    ?? services.find((s: any) => s.serviceType === "chatbot");

  if (!service) {
    throw new Error(`No provider found for model: ${model}. Available: ${services.map((s: any) => s.model).join(", ")}`);
  }

  const providerAddress = service.providerAddress;
  console.log(`⚡ Using provider ${providerAddress?.slice(0, 10)}... model=${service.model}`);

  // Get service metadata
  const { endpoint, model: providerModel } = await broker.inference.getServiceMetadata(providerAddress);

  // Generate per-request auth headers (TEE)
  const headers = await broker.inference.getRequestHeaders(providerAddress);

  // Call OpenAI-compatible endpoint
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model: providerModel, messages }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown");
    throw new Error(`0G compute failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const responseText = data.choices?.[0]?.message?.content ?? "";

  // TEE response verification
  const chatID = res.headers.get("ZG-Res-Key") || data.id;
  if (chatID) {
    try {
      await broker.inference.processResponse(providerAddress, chatID);
      console.log("✅ TEE response verified");
    } catch (err: any) {
      console.warn(`⚠️  TEE verification warning: ${err.message}`);
    }
  }

  return { response: responseText, computeResponseId: chatID || data.id };
}

export function getSolverAddress(): string {
  return solverAddress;
}

export function isBrokerReady(): boolean {
  return broker !== null;
}
