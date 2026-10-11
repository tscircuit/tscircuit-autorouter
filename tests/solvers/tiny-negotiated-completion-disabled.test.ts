import { expect, test } from "bun:test"
import {
  TinyNegotiatedCompletionController,
  type TinyNegotiatedCompletionCandidate,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyNegotiatedCompletionController"

test("disabled or empty negotiated completion never opens a fresh candidate budget", async (): Promise<void> => {
  for (const greedyFinalRouteIters of [0, -7, 0.9, 4]) {
    const empty = greedyFinalRouteIters === 4
    let remainingRouteReads = 0
    const unexpected = (): never => {
      throw new Error("disabled completion must not create or consume a candidate")
    }
    const controller = new TinyNegotiatedCompletionController<unknown, TinyNegotiatedCompletionCandidate>({
      solverOptions: { MAX_ITERATIONS: 2_000_000 },
      greedyFinalRouteIters,
      ripCount: 0,
      firstAttempt: -1,
      getRemainingRouteIds: (): number[] => {
        remainingRouteReads++
        return empty ? [] : [1, 4]
      },
      captureStartingSnapshot: unexpected,
      createCandidate: unexpected,
      seedCandidate: unexpected,
      accept: unexpected,
      reportFailure: unexpected,
    })
    expect(await controller.run()).toBe(false)
    expect(await controller.run()).toBe(false)
    expect(remainingRouteReads).toBe(empty ? 1 : 0)
  }
})
