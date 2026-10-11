import { expect, test } from "bun:test"
import {
  TinyNegotiatedCompletionController,
  type TinyNegotiatedCompletionAcceptance,
  type TinyNegotiatedCompletionCandidate,
  type TinyNegotiatedCompletionFailure,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyNegotiatedCompletionController"
import { shuffle } from "tiny-hypergraph/lib/shuffle"

type Candidate = TinyNegotiatedCompletionCandidate & { attempt: number }

test("negotiated completion retains ordered cost-aware and four greedy candidates with original seeds and budgets", async (): Promise<void> => {
  for (const firstAttempt of [-1, 0] as const) {
    const attempts = firstAttempt === -1 ? [-1, 0, 1, 2, 3] : [0, 1, 2, 3]
    for (const acceptedAttempt of [...attempts, null]) {
      const remainingRouteIds = [7, 2, 11, 5, 19]
      const snapshot = { fixedRouteIds: [3, 4] }
      const createdAttempts: number[] = []
      const solvedAttempts: number[] = []
      const seededAttempts: number[] = []
      let snapshotCount = 0
      let accepted: { candidate: Candidate; metadata: TinyNegotiatedCompletionAcceptance } | undefined
      let failure: TinyNegotiatedCompletionFailure | undefined
      const controller = new TinyNegotiatedCompletionController({
        solverOptions: {
          MAX_ITERATIONS: 2_000_000,
          minViaPadDiameter: 0.47,
          DISTANCE_TO_COST: 0.123,
          TRACE_DENSITY_COST_FACTOR: 0.25,
          ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
          GREEDY_FINAL_ROUTE_ITERS: 4,
          RIP_THRESHOLD_RAMP_ATTEMPTS: 50,
          STATIC_REACHABILITY_PRECHECK: true,
          OUTSIDE_IN_ROUTING: true,
          PARTIAL_RIP_ENABLED: true,
          PARTIAL_RIP_MAX_ATTEMPTS: 17,
        },
        greedyFinalRouteIters: 4.9,
        ripCount: 6,
        firstAttempt,
        getRemainingRouteIds: (): number[] => remainingRouteIds,
        captureStartingSnapshot: (): typeof snapshot => {
          snapshotCount++
          return snapshot
        },
        createCandidate: (attempt, options): Candidate => {
          createdAttempts.push(attempt)
          expect(options).toEqual({
            MAX_ITERATIONS: 50_000,
            minViaPadDiameter: 0.47,
            DISTANCE_TO_COST: 0.123,
            TRACE_DENSITY_COST_FACTOR: 0.25,
            ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
            GREEDY_FINAL_ROUTE_ITERS: 0,
            RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
            STATIC_REACHABILITY_PRECHECK: false,
            OUTSIDE_IN_ROUTING: false,
            PARTIAL_RIP_ENABLED: false,
            PARTIAL_RIP_MAX_ATTEMPTS: 17,
          })
          return {
            attempt,
            MAX_ITERATIONS: attempt < 0 ? 4_000_000 : options.MAX_ITERATIONS!,
            solved: false,
            failed: false,
            async solveAsync(): Promise<void> {
              solvedAttempts.push(attempt)
              this.solved = attempt === acceptedAttempt || attempt === -1
              this.failed = attempt !== acceptedAttempt
            },
          }
        },
        seedCandidate: (candidate, startingSnapshot, routeIds): void => {
          seededAttempts.push(candidate.attempt)
          expect(startingSnapshot).toBe(snapshot)
          expect(routeIds).toEqual(candidate.attempt <= 0
            ? remainingRouteIds
            : shuffle(remainingRouteIds, 6 + candidate.attempt))
          // The adapter can consume its work queue without changing later seeds.
          routeIds.shift()
        },
        accept: (candidate, metadata): void => {
          expect(accepted).toBeUndefined()
          accepted = { candidate, metadata }
        },
        reportFailure: (metadata): void => {
          expect(failure).toBeUndefined()
          failure = metadata
        },
      })
      const completion = controller.run()
      expect(controller.run()).toBe(completion)
      expect(await completion).toBe(acceptedAttempt !== null)
      expect(controller.run()).toBe(completion)
      expect(snapshotCount).toBe(1)
      expect(remainingRouteIds).toEqual([7, 2, 11, 5, 19])
      const consumedAttempts = acceptedAttempt === null
        ? attempts
        : attempts.slice(0, attempts.indexOf(acceptedAttempt) + 1)
      expect(createdAttempts).toEqual(consumedAttempts)
      expect(seededAttempts).toEqual(consumedAttempts)
      expect(solvedAttempts).toEqual(consumedAttempts)
      if (acceptedAttempt === null) {
        expect(accepted).toBeUndefined()
        expect(failure).toEqual({
          greedyFinalRouteAttemptCount: 4,
          greedyFinalRouteRemainingRouteCount: 5,
          greedyFinalRouteMaxIterations: 50_000,
        })
      } else {
        expect(failure).toBeUndefined()
        expect(accepted!.candidate.attempt).toBe(acceptedAttempt)
        expect(accepted!.metadata).toEqual({
          acceptedGreedyFinalRouteOnTimeout: true,
          greedyFinalRouteIter: Math.max(0, acceptedAttempt),
          finalRoutingStrategy: acceptedAttempt < 0 ? "congestion-aware" : "greedy",
          greedyFinalRouteRemainingRouteCount: 5,
          greedyFinalRouteMaxIterations: acceptedAttempt < 0 ? 4_000_000 : 50_000,
        })
      }
    }
  }
})
