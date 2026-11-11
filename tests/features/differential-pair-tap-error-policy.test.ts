import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 reports the same nonfatal differential pair failure with a tap", () => {
  const positiveStart = { x: -4, y: 0, layer: "top", pointId: "P.A" }
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -6, maxX: 6, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "P",
        pointsToConnect: [
          positiveStart,
          { x: 4, y: 0, layer: "top", pointId: "P.C" },
        ],
      },
      {
        name: "N",
        pointsToConnect: [
          { x: -4, y: 0.4, layer: "bottom", pointId: "N.A" },
          { x: 4, y: 0.4, layer: "bottom", pointId: "N.C" },
        ],
      },
    ],
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.25, lengthTolerance: 0.001 },
    ],
  }
  const inputWithTap = structuredClone(input)
  inputWithTap.connections.push({
    name: "tap",
    pointsToConnect: [
      positiveStart,
      { x: -5, y: 0, layer: "top", pointId: "TP" },
    ],
  })
  for (const srj of [input, inputWithTap]) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.error).toBeNull()
    const { postProcessingErrors } =
      solver.lengthMatchingPostProcessingSolver!.getOutput()
    expect(
      postProcessingErrors.map(({ stage, reason }) => ({ stage, reason })),
    ).toEqual([
      {
        stage: "differentialPairReroutingSolver",
        reason: "terminal-layer-mismatch",
      },
    ])
  }
})
