import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"
import fixture from "../fixtures/core-differential-pair-pad-clearance.json"

test("Pipeline9 omits late matching for differential pairs and unconstrained buses", (): void => {
  const busConfigurations: SimpleRouteJson["buses"][] = [
    undefined,
    [
      {
        busId: "unconstrained",
        connectionNames: ["source_trace_0", "source_trace_1"],
      },
    ],
    [
      {
        busId: "single_member",
        connectionNames: ["source_trace_0"],
        maxLengthSkew: 0.1,
      },
    ],
  ]
  for (const buses of busConfigurations) {
    const input = structuredClone(fixture) as SimpleRouteJson
    input.buses = buses
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    const stageNames = solver.pipelineDef.map((step) => step.solverName)
    expect(stageNames).toContain("differentialPairRoutingSolver")
    expect(stageNames).not.toContain("lengthMatchingPostProcessingSolver")
  }
})
