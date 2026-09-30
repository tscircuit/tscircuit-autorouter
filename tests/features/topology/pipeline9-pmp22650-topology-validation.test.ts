import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../../scripts/benchmark/scenarios"

test("validates the merged topology for the PMP22650 onboard charger", async (): Promise<void> => {
  const { scenario, scenarioName } = await loadScenarioBySampleNumber(
    "srj24",
    24,
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
    effort: 1,
    cacheProvider: null,
  })
  const startedAt = performance.now()

  solver.solveUntilPhase("nodeDimensionSubdivisionSolver")

  const durationMs = performance.now() - startedAt
  const topologyMergingSolver = solver.topologyMergingSolver!
  const outputNodes = topologyMergingSolver.getOutput()
  console.log(
    `PMP22650 topology merging duration=${durationMs.toFixed(3)}ms`,
  )

  expect(scenarioName).toBe("sample024")
  expect(scenario.connections).toHaveLength(409)
  expect(topologyMergingSolver.solved).toBe(true)
  expect(topologyMergingSolver.failed).toBe(false)
  expect(topologyMergingSolver.stats.inputNodeCount).toBe(23_197)
  expect(topologyMergingSolver.stats.atomicRegionCount).toBe(3_035_714)
  expect(topologyMergingSolver.stats.compactedRegionCount).toBe(62_491)
  expect(outputNodes).toHaveLength(62_491)
  expect(new Set(outputNodes.map((node) => node.capacityMeshNodeId)).size).toBe(
    outputNodes.length,
  )
})
