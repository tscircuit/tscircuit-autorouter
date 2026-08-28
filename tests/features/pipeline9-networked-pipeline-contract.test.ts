import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver9_Networked,
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_BODY_BYTES,
} from "lib"
import {
  AutoroutingPipelineSolver9_Networked as NetworkedPipelineFromPipelineIndex,
  type AutoroutingPipelineSolver9NetworkedOptions,
} from "lib/autorouter-pipelines"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-high-density-solver"
import type { SimpleRouteJson } from "lib/types"

const emptySrj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [],
  connections: [],
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
}

test("Pipeline9 networked is effort-1-only, async-only, and replaces only the high-density stage", () => {
  expect(
    () =>
      new AutoroutingPipelineSolver9_Networked(emptySrj, {
        effort: 2,
      } as any),
  ).toThrow("only available at effort=1")
  expect(
    () =>
      new AutoroutingPipelineSolver9_Networked(emptySrj, {
        hdCacheTimeoutMs: 20,
        hdCacheTransportTimeoutMs: 10,
      }),
  ).toThrow("transport timeout must be at least the logical request timeout")
  expect(
    () =>
      new AutoroutingPipelineSolver9_Networked(emptySrj, {
        hdCacheMaxBatchItems: 101,
      }),
  ).toThrow("max batch items must be a positive integer no greater than 100")
  expect(
    () =>
      new AutoroutingPipelineSolver9_Networked(emptySrj, {
        hdCacheMaxBatchBodyBytes:
          DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_BODY_BYTES + 1,
      }),
  ).toThrow("max batch body bytes must be a positive integer no greater than")

  const networkedSolver = new AutoroutingPipelineSolver9_Networked(emptySrj)
  const pipelineIndexOptions: AutoroutingPipelineSolver9NetworkedOptions = {
    effort: 1,
    hdCacheMaxBatchItems: 25,
    hdCacheMaxBatchBodyBytes: 500_000,
  }
  const customBatchSolver = new AutoroutingPipelineSolver9_Networked(
    emptySrj,
    pipelineIndexOptions,
  )
  const localSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    emptySrj,
  )
  const highDensityStepIndex = networkedSolver.pipelineDef.findIndex(
    (step) => step.solverName === "highDensityRouteSolver",
  )

  expect(networkedSolver.pipelineDef[highDensityStepIndex]!.solverClass).toBe(
    Pipeline9NetworkedHighDensitySolver,
  )
  expect(NetworkedPipelineFromPipelineIndex).toBe(
    AutoroutingPipelineSolver9_Networked,
  )
  expect(pipelineIndexOptions.effort).toBe(1)
  expect(customBatchSolver.hdCacheMaxBatchItems).toBe(25)
  expect(customBatchSolver.hdCacheMaxBatchBodyBytes).toBe(500_000)
  expect(networkedSolver.getSolverName()).toBe(
    "AutoroutingPipelineSolver9_Networked",
  )
  for (const [stepIndex, step] of networkedSolver.pipelineDef.entries()) {
    if (stepIndex === highDensityStepIndex) continue
    expect(step.solverClass).toBe(
      localSolver.pipelineDef[stepIndex]!.solverClass,
    )
  }
  expect(() => networkedSolver.solve()).toThrow("requires async execution")
  expect(() => networkedSolver.solveUntilPhase("none")).toThrow(
    "requires solveUntilPhaseAsync",
  )
})
