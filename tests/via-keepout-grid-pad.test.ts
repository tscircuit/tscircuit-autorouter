import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../lib/types/srj-types"

test("via keepout preserves the full planar grid pad and bottom-layer escape", () => {
  const common = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [-2.54, 0, 2.54].flatMap((x, i) =>
      [-2.54, 0, 2.54].map((y, j) => ({
        type: "rect",
        obstacleId: `pad${i}${j}`,
        componentId: "J1",
        center: { x, y },
        width: 1.4,
        height: 1.4,
        layers: ["top", "bottom"],
        connectedTo: [x === 0 && y === 0 ? "N" : `pad${i}${j}`],
      })),
    ),
    connections: [
      {
        name: "N",
        pointsToConnect: [
          { x: 0, y: 0, layers: ["top", "bottom"] },
          { x: 8, y: 0, layer: "bottom" },
        ],
      },
    ],
  }

  for (const withKeepout of [false, true]) {
    const srj = {
      ...common,
      ...(withKeepout
        ? {
            viaKeepouts: [
              {
                shape: "circle",
                center: { x: 0, y: 0 },
                radius: 0.1,
                layers: ["top"],
              },
            ],
          }
        : {}),
    } as SimpleRouteJson
    const solver = new Pipeline(srj, { cacheProvider: null, effort: 0.1 })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const traces = solver.getOutputSimplifiedPcbTraces()
    expect(traces).toHaveLength(1)
    expect(
      traces[0].route.every(
        (p) => p.route_type === "wire" && p.layer === "bottom",
      ),
    ).toBe(true)
    expect(traces[0].route[0]).toMatchObject({ x: 0, y: 0 })
    expect(traces[0].route.at(-1)).toMatchObject({ x: 8, y: 0 })
    if (withKeepout) {
      const pads = solver.capacityNodes!.filter(
        (n) => n._targetConnectionName === "N",
      )
      expect(pads).toHaveLength(2)
      for (const pad of pads)
        expect(pad).toMatchObject({
          center: { x: 0, y: 0 },
          width: 1.4,
          height: 1.4,
        })
    }
  }
})
