import { expect, test } from "bun:test"
import { distance, segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("new routes remove a needless slot detour without cutting its keepout", (): void => {
  const slot = {
    type: "rect" as const,
    layers: ["top", "bottom"],
    center: { x: 0, y: 0 },
    width: 4,
    height: 8,
    connectedTo: [],
  }
  for (const width of [0.15, 0.5]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: width,
      bounds: { minX: -11, maxX: 11, minY: -8, maxY: 8 },
      outline: [
        { x: -12, y: -9 }, { x: 12, y: -9 },
        { x: 12, y: 9 }, { x: -12, y: 9 },
      ],
      minBoardEdgeClearance: 0.2,
      minTraceToPadEdgeClearance: 0.1,
      obstacles: [
        ...[-7, 7].map((x) => ({
          type: "rect" as const, layers: ["top"], center: { x, y: 0 },
          width: 1, height: 1, connectedTo: ["p0", "p1", "signal"],
        })),
        slot,
      ],
      connections: [{
        name: "signal", nominalTraceWidth: width,
        pointsToConnect: [
          { x: -7, y: 0, layer: "top", pcb_port_id: "p0" },
          { x: 7, y: 0, layer: "top", pcb_port_id: "p1" },
        ],
      }],
    }
    const before = JSON.stringify(srj)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      cacheProvider: null,
    })
    solver.solve()
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    const traces = solver.getOutputSimplifiedPcbTraces()
    expect(traces).toHaveLength(1)
    const route = traces[0]!.route
    expect(route[0]).toMatchObject({ x: -7, y: 0 })
    expect(route.at(-1)).toMatchObject({ x: 7, y: 0 })
    expect(solver.getOutputSimpleRouteJson().connections).toEqual(srj.connections)
    let length = 0
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!
      const b = route[i]!
      expect(a).toMatchObject({ route_type: "wire", layer: "top", width })
      expect(b).toMatchObject({ route_type: "wire", layer: "top", width })
      if (a.route_type !== "wire" || b.route_type !== "wire") continue
      length += distance(a, b)
      expect(segmentToBoxMinDistance(a, b, slot) - width / 2).toBeGreaterThanOrEqual(0.1 - 1e-6)
    }
    // A known legal 45°/horizontal/45° path clears the physical slot by
    // 0.225 mm plus half the trace width. The original sampled jog is longer.
    const detourHeight = 4 + width / 2 + 0.225
    expect(length).toBeLessThanOrEqual(
      2 * Math.hypot(detourHeight, detourHeight) + 14 - 2 * detourHeight + 1e-6,
    )
    expect(JSON.stringify(srj)).toBe(before)
  }
})
