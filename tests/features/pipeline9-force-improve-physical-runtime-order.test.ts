import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import fixture from "../fixtures/pipeline9-native-world-guards/cmn42-valid-input-unsafe-force-proposal.json"

test("force improvement applies the same physical proposal acceptance after ordered worker results", async () => {
  const input = {
    nodeWithPortPoints: [fixture.node as NodeWithPortPoints],
    hdRoutes: structuredClone(fixture.routes) as HighDensityRoute[],
    totalStepsPerNode: 20,
    nodeAssignmentMargin: 0.15,
    physicalValidation: {
      connectivityNetMap: fixture.connectivityNetMap,
      layerCount: fixture.layerCount,
      allowBlindAndBuriedVias: fixture.allowBlindAndBuriedVias,
      traceClearance: 0.1,
      viaHoleDiameter: fixture.viaHoleDiameter,
      minViaHoleEdgeToViaHoleEdgeClearance: fixture.minViaHoleEdgeToViaHoleEdgeClearance,
      boardObstacles: fixture.boardObstacles as Obstacle[],
      viaToPadClearance: 0.1,
    },
  }
  let calls = 0
  const runtime = {
    async executeAsync(Solver: new (params: unknown) => {
      solve: () => void
      getOutput: () => unknown
    }, params: unknown): Promise<unknown> {
      calls++
      const solver = new Solver(params)
      solver.solve()
      return solver.getOutput()
    },
  } as unknown as SolverRuntimeExecutor
  const serial = new Pipeline9HighDensityForceImproveSolver(structuredClone(input))
  serial.solve()
  const parallel = new Pipeline9HighDensityForceImproveSolver(structuredClone(input))
  await parallel.solveAsync(runtime)
  expect(calls).toBe(1)
  expect(parallel.solved).toBe(true)
  expect(parallel.getOutput()).toEqual(serial.getOutput())
  expect(parallel.getOutput()).toEqual(input.hdRoutes)
  expect(parallel.stats.physicalCandidateRejectionCount).toBe(1)
  expect(parallel.stats.improvedRouteCount).toBe(0)
})
