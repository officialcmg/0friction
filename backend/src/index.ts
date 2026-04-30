import express from "express";
import cors from "cors";
import { config, validateConfig } from "./config.js";
import { initBroker, isBrokerReady, getSolverAddress } from "./broker.js";
import { quoteRouter } from "./routes/quote.js";
import { intentRouter } from "./routes/intent.js";
import { jobsRouter } from "./routes/jobs.js";

async function main() {
  console.log(`
╔══════════════════════════════════════╗
║       0friction Solver Backend       ║
║  Cross-chain AI compute via 0G       ║
╚══════════════════════════════════════╝
  `);

  validateConfig();

  // Initialize 0G broker
  await initBroker();

  // Create Express server
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/health", (_, res) => {
    res.json({
      status: "ok",
      broker: isBrokerReady(),
      solver: getSolverAddress() || "not configured",
      homeChain: config.homeChainId,
      mockMode: config.enableMockFallback,
    });
  });

  // API routes
  app.use("/v1/quote", quoteRouter);
  app.use("/v1/intent/submit", intentRouter);
  app.use("/v1/jobs", jobsRouter);

  // Start server
  app.listen(config.port, () => {
    console.log(`\n🚀 Solver running on http://localhost:${config.port}`);
    console.log(`   Health: http://localhost:${config.port}/health`);
    console.log(`   Quote:  POST http://localhost:${config.port}/v1/quote`);
    console.log(`   Submit: POST http://localhost:${config.port}/v1/intent/submit`);
    console.log(`   Jobs:   GET  http://localhost:${config.port}/v1/jobs/:jobId`);
    console.log(`\n   Mock mode: ${config.enableMockFallback ? "ENABLED" : "disabled"}`);
    console.log(`   Home chain: ${config.homeChainId} (Base Sepolia)`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
