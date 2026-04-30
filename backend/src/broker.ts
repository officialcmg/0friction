import { ethers } from "ethers";
import { config } from "./config.js";

// ─── Broker State ────────────────────────────────────────────

let broker: any = null;
let solverWallet: ethers.Wallet | null = null;
let solverAddress: string = "";

/**
 * Initialize the 0G Compute Network broker.
 * This connects to 0G Chain and sets up the solver's identity.
 */
export async function initBroker(): Promise<void> {
  if (!config.solverPrivateKey) {
    console.warn("⚠️  No SOLVER_PRIVATE_KEY — broker disabled (mock mode available)");
    return;
  }

  try {
    const provider = new ethers.JsonRpcProvider(config.zgRpcUrl);
    solverWallet = new ethers.Wallet(config.solverPrivateKey, provider);
    solverAddress = await solverWallet.getAddress();

    console.log(`🔑 Solver address on 0G: ${solverAddress}`);

    // Dynamic import to handle potential module issues
    const { createZGComputeNetworkBroker } = await import("@0gfoundation/0g-compute-ts-sdk");
    broker = await createZGComputeNetworkBroker(solverWallet);

    console.log("✅ 0G Broker initialized");

    // Check ledger status
    try {
      const services = await broker.inference.listService();
      console.log(`📋 Found ${services.length} available services on 0G`);

      const chatServices = services.filter((s: any) => s.serviceType === "chatbot");
      for (const svc of chatServices) {
        console.log(`   📡 ${svc.model} @ ${svc.providerAddress?.slice(0, 10)}...`);
      }
    } catch (err: any) {
      console.warn(`⚠️  Could not list services: ${err.message}`);
    }
  } catch (err: any) {
    console.error(`❌ Broker init failed: ${err.message}`);
    console.warn("⚠️  Running without 0G broker — mock mode may be needed");
  }
}

/**
 * Execute an AI inference request via 0G Compute.
 * Returns the AI response text and metadata.
 */
export async function executeCompute(
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<{ response: string; computeResponseId?: string }> {
  // Mock fallback for demo resilience
  if (!broker || config.enableMockFallback) {
    console.log("🎭 Mock mode — returning simulated response");
    await new Promise((r) => setTimeout(r, 800)); // simulate latency

    return {
      response: `[Mock] This is a simulated response from ${model}. In production, this would be a real AI response from 0G Compute Network. Your message had ${messages.length} message(s).`,
      computeResponseId: `mock_${Date.now()}`,
    };
  }

  // Find provider for the requested model
  const services = await broker.inference.listService();
  const service = services.find((s: any) => s.model === model);

  if (!service) {
    throw new Error(`No provider found for model: ${model}`);
  }

  const providerAddress = service.providerAddress;

  // Get service metadata (endpoint + model name)
  const { endpoint, model: providerModel } = await broker.inference.getServiceMetadata(providerAddress);

  // Generate per-request auth headers
  const headers = await broker.inference.getRequestHeaders(providerAddress);

  // Make OpenAI-compatible inference call
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      model: providerModel,
      messages,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown");
    throw new Error(`0G compute failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const responseText = data.choices?.[0]?.message?.content ?? "";

  // Verify TEE integrity
  const chatID = res.headers.get("ZG-Res-Key") || data.id;
  if (chatID) {
    try {
      await broker.inference.processResponse(providerAddress, chatID);
    } catch (err: any) {
      console.warn(`⚠️  TEE verification warning: ${err.message}`);
    }
  }

  return {
    response: responseText,
    computeResponseId: chatID || data.id,
  };
}

export function getSolverAddress(): string {
  return solverAddress;
}

export function isBrokerReady(): boolean {
  return broker !== null;
}
