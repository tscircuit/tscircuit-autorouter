import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import srj from "../fixtures/core-differential-pair-pad-clearance.json"

test("differential-pair and bus constraints explicitly retain the original route allocator", () => {
  const pair = structuredClone(srj) as SimpleRouteJson
  const bus = structuredClone(srj) as SimpleRouteJson
  delete bus.differentialPairs
  bus.buses = [{ busId: "matched-bus", connectionNames: bus.connections.map((connection) => connection.name), maxLengthSkew: 0.05 }]
  for (const input of [pair, bus]) {
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
    while (!pipeline.failed && !pipeline.portPointPathingSolver?.solved) pipeline.step()
    expect(pipeline.failed).toBe(false)
    expect(pipeline.portPointPathingSolver!.stats.symbolicCorridorUnsupportedCoupledConstraints).toBe(1)
    expect(pipeline.portPointPathingSolver!.stats.symbolicCorridorAcceptedProblems).toBe(0)
    expect(pipeline.portPointPathingSolver!.getOutput().nodesWithPortPoints.length).toBeGreaterThan(0)
  }
})
