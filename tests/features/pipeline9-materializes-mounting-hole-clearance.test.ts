import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 passes the reference mounting-hole default to every repair stage", (): void => {
  for (const declared of [undefined, 0, 0.3]) {
    const input: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1524,
      minTraceToHoleEdgeClearance: declared,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      connections: [],
      obstacles: [{
        type: "rect",
        isNonPlatedHole: true,
        shape: "circle",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top", "bottom"],
        connectedTo: [],
      }],
    }
    const original = structuredClone(input)
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
    const originalClearance = pipeline.originalSrj.minTraceToHoleEdgeClearance
    expect(originalClearance).toBe(declared ?? 0.2)
    expect(pipeline.srj.minTraceToHoleEdgeClearance).toBe(declared ?? 0.2)
    expect(input).toEqual(original)
  }
})
