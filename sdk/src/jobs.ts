import type { ZeroFrictionConfig, Job } from "./types.js";
import { RetryableNetworkError, ZeroFrictionError } from "./errors.js";

/** Jobs module — polls job status and retrieves results */
export function createJobsModule(config: ZeroFrictionConfig) {
  return {
    /**
     * Get the current status of a compute job.
     *
     * @example
     * ```ts
     * const job = await client.jobs.get("job_abc123");
     * if (job.status === "SETTLED") {
     *   console.log(job.response);
     * }
     * ```
     */
    async get(jobId: string): Promise<Job> {
      const res = await fetch(`${config.solverUrl}/v1/jobs/${jobId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }).catch((err) => {
        throw new RetryableNetworkError(err.message);
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "unknown error");
        throw new ZeroFrictionError(`Job fetch failed (${res.status}): ${body}`);
      }

      return res.json();
    },

    /**
     * Poll a job until it reaches a terminal state.
     * Returns the final job state.
     */
    async poll(jobId: string, intervalMs: number = 1000, maxAttempts: number = 60): Promise<Job> {
      for (let i = 0; i < maxAttempts; i++) {
        const job = await this.get(jobId);

        if (
          job.status === "SETTLED" ||
          job.status.startsWith("FAILED_")
        ) {
          return job;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      throw new ZeroFrictionError(`Job ${jobId} did not complete within ${maxAttempts} polling attempts`);
    },
  };
}
