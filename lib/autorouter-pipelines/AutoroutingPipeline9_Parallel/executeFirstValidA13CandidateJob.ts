import { createFirstValidA13Candidate } from "./createFirstValidA13Candidate"
import type { FirstValidA13CandidateJob, FirstValidA13CandidateResult } from "./firstValidA13CandidateTypes"

/** A speculative candidate owns no global cache and cannot create other workers. */
export function executeFirstValidA13CandidateJob(job: FirstValidA13CandidateJob): FirstValidA13CandidateResult {
  const solver = createFirstValidA13Candidate(job)
  const cancellation = job.cancellationBuffer ? new Int32Array(job.cancellationBuffer) : undefined
  const work = (): Pick<FirstValidA13CandidateResult, "kind" | "iterations" | "maxIterations" | "routingIterations" | "sourceStats"> => ({
    kind: "firstValidA13Candidate",
    iterations: solver.iterations,
    maxIterations: solver.MAX_ITERATIONS,
    routingIterations: solver.routingIterations,
    sourceStats: { ...solver.stats },
  })
  try {
    while (!solver.solved && !solver.failed) {
      if (cancellation && Atomics.load(cancellation, 0) !== 0) return { ...work(), status: "cancelled" }
      // The original call executes at most its configured 1000-step kernel
      // batch; cancellation never replaces the public effort/search limits.
      solver.step()
    }
    if (solver.solved) return { ...work(), status: "solved", routes: solver.getOutput() }
    if (!solver.error) throw new Error("First-valid A13 failed without an error")
    return { ...work(), status: "failed", error: solver.error }
  } catch (error: unknown) {
    return { ...work(), status: "exception", exception: error instanceof Error
      ? { name: error.name, message: error.message } : { name: "Error", message: String(error) } }
  }
}
