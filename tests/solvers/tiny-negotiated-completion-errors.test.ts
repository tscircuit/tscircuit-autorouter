import { expect, test } from "bun:test"
import {
  TinyNegotiatedCompletionController,
  type TinyNegotiatedCompletionCandidate,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyNegotiatedCompletionController"

test("negotiated completion propagates consumed adapter and worker exceptions without trying another strategy", async (): Promise<void> => {
  for (const errorAt of ["capture", "create", "seed", "solve", "accept", "reportFailure"] as const) {
    const error = new Error(`completion ${errorAt} failure`)
    const attempts: number[] = []
    let acceptedCount = 0
    let failureCount = 0
    const controller = new TinyNegotiatedCompletionController({
      solverOptions: { MAX_ITERATIONS: 2_000_000 },
      greedyFinalRouteIters: 4,
      ripCount: 3,
      firstAttempt: -1,
      getRemainingRouteIds: (): number[] => [5, 9],
      captureStartingSnapshot: (): { immutable: true } => {
        if (errorAt === "capture") throw error
        return { immutable: true }
      },
      createCandidate: (attempt, options): TinyNegotiatedCompletionCandidate => {
        attempts.push(attempt)
        if (errorAt === "create") throw error
        return {
          MAX_ITERATIONS: options.MAX_ITERATIONS!,
          solved: false,
          failed: false,
          async solveAsync(): Promise<void> {
            if (errorAt === "solve") throw error
            this.solved = errorAt === "accept"
            this.failed = !this.solved
          },
        }
      },
      seedCandidate: (): void => {
        if (errorAt === "seed") throw error
      },
      accept: (): void => {
        acceptedCount++
        if (errorAt === "accept") throw error
      },
      reportFailure: (): void => {
        failureCount++
        if (errorAt === "reportFailure") throw error
      },
    })
    const completion = controller.run()
    await expect(completion).rejects.toBe(error)
    expect(controller.run()).toBe(completion)
    expect(attempts).toEqual(errorAt === "capture" ? []
      : errorAt === "reportFailure" ? [-1, 0, 1, 2, 3]
      : [-1])
    expect(acceptedCount).toBe(errorAt === "accept" ? 1 : 0)
    expect(failureCount).toBe(errorAt === "reportFailure" ? 1 : 0)
  }
})
