import { expect, test } from "bun:test"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { loadA64DdrHighDensityMemoryParams } from "../fixtures/loadA64DdrMemoryFixture"

test.failing(
  "Pipeline9 keeps production regional routing free of search debug history",
  (): void => {
    const params = loadA64DdrHighDensityMemoryParams()
    expect(params.obstacles).toHaveLength(2133)
    expect(params.layerCount).toBe(6)
    const solver = new Pipeline9HighDensitySolver(params)
    while (
      solver.activeFallbackSolver?.params.nodeWithPortPoints.capacityMeshNodeId !==
        "new-cmn_55-603__sub_0_0" &&
      !solver.solved &&
      !solver.failed &&
      solver.iterations < 100_000
    ) {
      solver.step()
    }
    const regional = solver.activeFallbackSolver
    expect(regional).not.toBeNull()
    expect(regional!.params.nodeWithPortPoints.capacityMeshNodeId).toBe(
      "new-cmn_55-603__sub_0_0",
    )
    expect(regional!.highDensitySolver.captureSearchDebug).toBeFalse()
  },
)
