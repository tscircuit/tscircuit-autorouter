import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Networked } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/AutoroutingPipelineSolver9_Networked"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import { Pipeline9NetworkedHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensityRepairSolver"
import { Pipeline9RemainingForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9RemainingForceImproveSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"

test("networked force and repair waves preserve final Pipeline9 routes and DRC", async (): Promise<void> => {
  const scenario: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -4.123456, y: 0, layer: "top", pcb_port_id: "left" },
          { x: 4.123456, y: 0, layer: "top", pcb_port_id: "right" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -4.123456, layer: "top", pcb_port_id: "bottom" },
          { x: 0, y: 4.123456, layer: "top", pcb_port_id: "top" },
        ],
      },
    ],
  }
  const local = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort: 1, cacheProvider: null },
  )
  local.solve()
  expect(local.solved, local.error ?? "").toBeTrue()

  const server = new ExampleHdCache2Server({ batchItemMode: "solve" })
  const remote = new AutoroutingPipelineSolver9_Networked(
    structuredClone(scenario),
    { effort: 1, cacheProvider: null, hdCache2ServerUrl: server.url },
  )
  try {
    await remote.solveAsync()
    expect(remote.solved, remote.error ?? "").toBeTrue()
    const highDensity =
      remote.highDensityRouteSolver as Pipeline9NetworkedHighDensitySolver
    const force =
      remote.highDensityForceImproveSolver as Pipeline9RemainingForceImproveSolver
    const repair =
      remote.highDensityRepairSolver as Pipeline9NetworkedHighDensityRepairSolver
    expect(highDensity.forceImprovedRegionIds.size).toBeGreaterThan(0)
    expect(highDensity.stats.remoteTransportFallbacks).toBe(0)
    expect(force.stats.sampleCount).toBe(0)
    expect(
      repair.stats.remoteRepairResultsApplied +
        (repair.stats.localTrivialRepairCount ?? 0),
    ).toBe(repair.sampleEntries.length)
    expect(repair.stats.remoteTransportFallbacks).toBe(0)
    expect(remote.getOutputSimplifiedPcbTraces()).toEqual(
      local.getOutputSimplifiedPcbTraces(),
    )
    expect(
      evaluateRelaxedDrc({
        inputSrj: scenario,
        srjWithPointPairs: remote.srjWithPointPairs!,
        routedTraces: remote.getOutputSimplifiedPcbTraces(),
      }).errors,
    ).toEqual([])
  } finally {
    await server.close()
  }
})
