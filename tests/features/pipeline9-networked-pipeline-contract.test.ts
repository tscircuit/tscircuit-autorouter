import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver9_Networked,
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
} from "lib"
import {
  AutoroutingPipelineSolver9_Networked as NetworkedPipelineFromPipelineIndex,
  type AutoroutingPipelineSolver9NetworkedOptions,
} from "lib/autorouter-pipelines"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import type { SimpleRouteJson } from "lib/types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"

const emptySrj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [],
  connections: [],
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
}

test("Pipeline9 networked is effort-1-only, async-only, and replaces only the high-density stage", async () => {
  const server = new ExampleHdCache2Server()
  try {
    expect(
      () =>
        new AutoroutingPipelineSolver9_Networked(emptySrj, {
          effort: 2,
        } as any),
    ).toThrow("only available at effort=1")

    const networkedSolver = new AutoroutingPipelineSolver9_Networked(emptySrj, {
      effort: 1,
      hdCache2ServerUrl: server.url,
    })
    const pipelineIndexOptions: AutoroutingPipelineSolver9NetworkedOptions = {
      effort: 1,
      hdCache2ServerUrl: server.url,
    }
    const customServerSolver = new AutoroutingPipelineSolver9_Networked(
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
    expect(customServerSolver.hdCache2ServerUrl).toBe(server.url)
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
  } finally {
    await server.close()
  }
})
