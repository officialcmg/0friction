import "dotenv/config";

export const config = {
  // 0G Chain (solver identity)
  solverPrivateKey: process.env.SOLVER_PRIVATE_KEY!,
  zgRpcUrl: process.env.ZG_RPC_URL || "https://evmrpc-testnet.0g.ai",

  // Home chain (Base Sepolia for settlement)
  homeChainRpc: process.env.HOME_CHAIN_RPC || "https://sepolia.base.org",
  homeChainPrivateKey: process.env.HOME_CHAIN_PRIVATE_KEY!,
  homeChainId: parseInt(process.env.HOME_CHAIN_ID || "84532"),

  // USDC
  usdcAddress: (process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`,

  // Pricing
  a0giToUsdc: parseFloat(process.env.A0GI_TO_USDC || "0.05"),
  riskMargin: parseFloat(process.env.RISK_MARGIN || "0.20"),
  feeFloor: parseFloat(process.env.FEE_FLOOR || "0.001"),
  quoteTtlSeconds: parseInt(process.env.QUOTE_TTL_SECONDS || "60"),

  // 0G Provider
  defaultProviderAddress: process.env.DEFAULT_PROVIDER_ADDRESS || "",
  defaultModel: process.env.DEFAULT_MODEL || "qwen/qwen-2.5-7b-instruct",

  // Server
  port: parseInt(process.env.PORT || "3001"),

  // Demo
  enableMockFallback: process.env.ENABLE_MOCK_FALLBACK === "true",
};

/** Validate that required config is present */
export function validateConfig() {
  const required = [
    ["SOLVER_PRIVATE_KEY", config.solverPrivateKey],
    ["HOME_CHAIN_PRIVATE_KEY", config.homeChainPrivateKey],
  ] as const;

  for (const [name, value] of required) {
    if (!value) {
      console.warn(`⚠️  Missing ${name} — some features will be disabled`);
    }
  }
}
