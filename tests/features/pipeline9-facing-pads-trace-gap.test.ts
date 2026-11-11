import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("Pipeline 9 preserves the requested trace gap between facing pads", (): void => {
  for (const { offset, maxUncoupledLength } of [
    { offset: 0, maxUncoupledLength: undefined },
    { offset: 0.001, maxUncoupledLength: undefined },
    { offset: 0.001, maxUncoupledLength: 2 },
  ]) {
    const connections: SimpleRouteJson["connections"] = [-0.5, 0.5].map(
      (y) => ({
        name: y < 0 ? "N" : "P",
        nominalTraceWidth: 0.15,
        pointsToConnect: [-5, 5].map((x) => ({
          x: x + (y > 0 ? offset : 0),
          y,
          layer: "top",
        })),
      }),
    )
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
        {
          connectionNames: ["P", "N"],
          lengthTolerance: 0.1,
          traceGap,
          maxUncoupledLength,
        },
      ],
    }
    const solver = new Pipeline9(srj, { cacheProvider: null })
    solver.solve()
    expect(solver.solved).toBe(true)
    const traces = solver.getOutputSimplifiedPcbTraces()
    expect(traces).toHaveLength(2)
    expect(solver.lengthMatchingPostProcessingSolver?.solved).toBe(true)
    for (const x of [-2, 0, 2]) {
      const centerYs = traces.map(({ route }) => {
        for (let i = 1; i < route.length; i++) {
          const a = route[i - 1]!
          const b = route[i]!
          if (
            a.route_type !== "wire" ||
            b.route_type !== "wire" ||
            a.layer !== "top" ||
            b.layer !== "top" ||
            a.x === b.x ||
            (a.x - x) * (b.x - x) > 0
          )
            continue
          expect(a.width).toBe(0.15)
          expect(b.width).toBe(0.15)
          return a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x)
        }
        throw new Error(`No top-layer wire crosses x=${x}`)
      })
      expect(Math.abs(centerYs[0]! - centerYs[1]!) - 0.15).toBeCloseTo(
        traceGap,
        6,
      )
    }
    if (offset === 0) {
      expect(
        convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson()),
      ).toMatchGraphicsSvg(import.meta.path, { backgroundColor: "white" })
    }
  }
})
