import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("Pipeline 9 preserves the requested trace gap between facing pads", (): void => {
  const connections: SimpleRouteJson["connections"] = [-0.5, 0.5].map((y) => ({
    name: y < 0 ? "N" : "P",
    nominalTraceWidth: 0.15,
    pointsToConnect: [-5, 5].map((x) => ({ x, y, layer: "top" })),
  }))
  const traceGap = 0.3
  const srj: SimpleRouteJson = {
    connections,
    obstacles: connections.flatMap((net) =>
      net.pointsToConnect.map(({ x, y }) => ({
        type: "rect",
        center: { x, y },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: [net.name],
      })),
    ),
    bounds: { minX: -10, maxX: 10, minY: -6, maxY: 6 },
    layerCount: 2,
    minTraceWidth: 0.1,
    differentialPairs: [
      { connectionNames: ["P", "N"], lengthTolerance: 0.1, traceGap },
    ],
  }
  const solver = new Pipeline9(srj, { cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(2)
  const centerYs = traces.map((trace) => {
    const wires = trace.route.filter((point) => point.route_type === "wire")
    const i = wires.findIndex(
      (p, i) => i > 0 && wires[i - 1]!.x < 0 && p.x >= 0,
    )
    expect(i).toBeGreaterThan(0)
    const a = wires[i - 1]!
    const b = wires[i]!
    expect(a.layer).toBe("top")
    expect(b.layer).toBe("top")
    expect(a.width).toBe(0.15)
    expect(b.width).toBe(0.15)
    return a.y - (a.x * (b.y - a.y)) / (b.x - a.x)
  })
  const actualGap = Math.abs(centerYs[0]! - centerYs[1]!) - 0.15
  expect(actualGap).toBeCloseTo(traceGap, 6)
  expect(
    convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson()),
  ).toMatchGraphicsSvg(import.meta.path, { backgroundColor: "white" })
})
