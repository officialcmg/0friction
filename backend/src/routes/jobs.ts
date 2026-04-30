import { Router } from "express";
import { getJob } from "../store.js";

const router = Router();

/**
 * GET /v1/jobs/:jobId
 *
 * Returns the current state of a compute job.
 */
router.get("/:jobId", (req, res) => {
  const { jobId } = req.params;

  const job = getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  return res.json({
    jobId: job.jobId,
    status: job.status,
    response: job.response,
    model: job.model,
    chargedUsdc: job.chargedUsdc,
    settlementTxHash: job.settlementTxHash,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    auditBundle: job.status === "SETTLED" || job.status.startsWith("FAILED_")
      ? {
          quoteId: job.quoteId,
          intentHash: job.intentHash,
          promptHash: job.promptHash,
          computeResponseId: job.computeResponseId,
          settlementTxHash: job.settlementTxHash,
          chargedUsdc: job.chargedUsdc,
          timestamp: job.updatedAt,
        }
      : undefined,
  });
});

export { router as jobsRouter };
