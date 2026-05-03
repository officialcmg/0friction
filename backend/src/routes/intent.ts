import { Router } from "express";
import { config } from "../config.js";
import { getQuote, markQuoteUsed, createJob, updateJob } from "../store.js";
import { verifyIntentSignature, verifyPromptHash } from "../verify.js";
import { executeCompute } from "../broker.js";
import { settlePayment } from "../settlement.js";

const router = Router();

/**
 * POST /v1/intent/submit
 *
 * Accepts a signed intent + permit package.
 * Verifies signatures, executes 0G compute, settles USDC payment.
 */
router.post("/", async (req, res) => {
  try {
    const { intent, intentSignature, permit, permitSignature, requestPayload, quoteId } = req.body;

    // ─── Validate inputs ───────────────────────────────────
    if (!intent || !intentSignature || !permit || !permitSignature || !requestPayload || !quoteId) {
      return res.status(400).json({
        error: "Missing required fields: intent, intentSignature, permit, permitSignature, requestPayload, quoteId",
      });
    }

    // ─── Check quote ───────────────────────────────────────
    const storedQuote = getQuote(quoteId);
    if (!storedQuote) {
      return res.status(400).json({ error: "Quote not found or expired" });
    }
    if (storedQuote.used) {
      return res.status(400).json({ error: "Quote already used" });
    }

    // ─── Create job ────────────────────────────────────────
    const job = createJob({
      quoteId,
      owner: intent.owner,
      model: intent.model,
      maxUsdc: intent.maxUsdc,
      intentHash: intentSignature.slice(0, 66),
      promptHash: intent.promptHash,
    });

    console.log(`\n🆕 Job ${job.jobId} from ${intent.owner.slice(0, 10)}...`);

    // ─── Verify signatures ─────────────────────────────────
    updateJob(job.jobId, { status: "VERIFIED" });

    // Verify prompt hash
    const hashValid = verifyPromptHash(requestPayload, intent.promptHash);
    if (!hashValid) {
      updateJob(job.jobId, { status: "FAILED_VERIFICATION", error: "Prompt hash mismatch" });
      return res.status(400).json({ error: "Prompt hash does not match payload", jobId: job.jobId });
    }

    // Verify intent signature (skip in mock mode for easier testing)
    if (!config.enableMockFallback) {
      const sigValid = await verifyIntentSignature(intent, intentSignature, config.homeChainId);
      if (!sigValid) {
        updateJob(job.jobId, { status: "FAILED_VERIFICATION", error: "Invalid intent signature" });
        return res.status(400).json({ error: "Invalid intent signature", jobId: job.jobId });
      }
    }

    // Mark quote as used (prevent replay)
    markQuoteUsed(quoteId);

    // ─── Execute compute ───────────────────────────────────
    updateJob(job.jobId, { status: "EXECUTING" });
    console.log(`⚡ Executing compute for job ${job.jobId}...`);

    let computeResult;
    try {
      computeResult = await executeCompute(requestPayload.model, requestPayload.messages);
    } catch (err: any) {
      updateJob(job.jobId, { status: "FAILED_EXECUTION", error: err.message });
      return res.status(502).json({ error: `Compute failed: ${err.message}`, jobId: job.jobId });
    }

    updateJob(job.jobId, {
      status: "EXECUTED",
      response: computeResult.response,
      computeResponseId: computeResult.computeResponseId,
    });

    console.log(`✅ Compute done for job ${job.jobId} (${computeResult.response.length} chars)`);

    // ─── Settle payment ────────────────────────────────────
    updateJob(job.jobId, { status: "SETTLING" });

    let settlementTxHash = "";
    let settlementError: string | null = null;
    try {
      console.log(`💳 Starting settlement for ${permit.owner}...`);
      console.log(`   permit.value=${permit.value}, permit.deadline=${permit.deadline}, permit.nonce=${permit.nonce}`);
      const result = await settlePayment({
        permit: {
          owner: permit.owner as `0x${string}`,
          spender: permit.spender as `0x${string}`,
          value: permit.value,
          deadline: permit.deadline,
        },
        permitSignature: permitSignature as `0x${string}`,
        actualChargeAtomic: BigInt(storedQuote.maxChargeUsdcAtomic),
      });
      settlementTxHash = result.txHash;
      console.log(`✅ Settlement tx: ${settlementTxHash}`);
    } catch (err: any) {
      settlementError = err.message;
      console.error(`❌ SETTLEMENT FAILED: ${err.message}`);
      console.error(`   Stack: ${err.stack?.split("\n").slice(0, 3).join(" -> ")}`);
    }

    const hasRealSettlementTx = settlementTxHash.startsWith("0x");
    const isInsufficientFunds = settlementTxHash.includes("insufficient");
    const isMockSettlement = settlementTxHash.startsWith("mock_settle_");

    if (hasRealSettlementTx) {
      updateJob(job.jobId, {
        status: "SETTLED",
        chargedUsdc: storedQuote.maxChargeUsdc,
        settlementTxHash,
      });
    } else if (isMockSettlement) {
      updateJob(job.jobId, {
        status: "SETTLED",
        chargedUsdc: "0",
        settlementTxHash,
        error: "Settlement skipped: HOME_CHAIN_PRIVATE_KEY not configured",
      });
    } else {
      updateJob(job.jobId, {
        status: "FAILED_SETTLEMENT",
        chargedUsdc: "0",
        settlementTxHash: settlementTxHash || undefined,
        error:
          settlementError ||
          (isInsufficientFunds ? "Insufficient user USDC balance" : "Settlement failed before tx confirmation"),
      });
    }

    // ─── Return response ───────────────────────────────────
    const finalJob = updateJob(job.jobId, {})!;
    return res.json({
      jobId: finalJob.jobId,
      status: finalJob.status,
      response: finalJob.response,
      auditBundle: {
        quoteId: finalJob.quoteId,
        intentHash: finalJob.intentHash,
        promptHash: finalJob.promptHash,
        computeResponseId: finalJob.computeResponseId,
        settlementTxHash: finalJob.settlementTxHash,
        chargedUsdc: finalJob.chargedUsdc,
        timestamp: finalJob.updatedAt,
      },
    });
  } catch (err: any) {
    console.error("Intent submit error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export { router as intentRouter };
