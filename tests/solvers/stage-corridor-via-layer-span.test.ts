import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/FindClearancePathSolver"
import type { CorridorPathInput } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createVisibilityCorridorSearch"

test("cloned corridor search distinguishes full-stack copper from explicitly blind vias", (): void => {
  const start = { x: -1, y: 0, z: 0 }
  const end = { x: 1, y: 0, z: 1 }
  const bounds = { minX: -2, maxX: 2, minY: -1, maxY: 1 }
  const route = { connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3, route: [start, end], vias: [] }
  for (const allowBlindAndBuriedVias of [false, true]) {
    const input: CorridorPathInput = {
      srj: {
        bounds, layerCount: 4, minTraceWidth: 0.1,
        allowBlindAndBuriedVias,
        connections: [{ name: "signal", pointsToConnect: [] }],
        obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 12, height: 12, layers: ["inner2"], connectedTo: ["foreign"] }],
      },
      bounds, routes: [route], routeIndex: 0, start, end,
      traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1, maxNodes: 1000,
    }
    const solver = new FindClearancePathSolver(input)
    while (!solver.solved && !solver.failed) solver.step()
    expect(solver.failed).toBe(false)
    const path = solver.getOutput()
    expect(Boolean(path)).toBe(allowBlindAndBuriedVias)
    expect((solver.stats as typeof solver.stats & { corridorEdgeChecks: number }).corridorEdgeChecks).toBeGreaterThan(0)
    if (!path) {
      expect(solver.stats.completionReason).toBe("no-path")
      continue
    }
    expect(path[0]).toEqual(start)
    expect(path.at(-1)).toEqual(end)
    let viaCount = 0
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1]!, b = path[index]!
      expect([0, 1]).toContain(a.z)
      expect([0, 1]).toContain(b.z)
      if (a.z === b.z) continue
      viaCount++
      expect(a.x).toBe(b.x)
      expect(a.y).toBe(b.y)
      // A blind 0→1 span excludes the foreign inner2 copper. A default
      // physical through-hole would occupy that blocked layer at every XY.
      expect(Math.min(a.z, b.z)).toBe(0)
      expect(Math.max(a.z, b.z)).toBe(1)
    }
    expect(viaCount).toBe(1)
  }
})
