import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/FindClearancePathSolver"
import type { CorridorPathInput } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createVisibilityCorridorSearch"

test("cloned corridor search shares same-net copper but reserves owned pads against vias", (): void => {
  const start = { x: -1, y: 0, z: 0 }, end = { x: 1, y: 0, z: 0 }
  const bounds = { minX: -2, maxX: 2, minY: -1, maxY: 1 }
  for (const sharedRoot of [false, true]) {
    const input: CorridorPathInput = {
      srj: { bounds, layerCount: 2, minTraceWidth: 0.1, connections: [], obstacles: [] },
      routes: [
        { connectionName: "signal", rootConnectionName: "root", traceThickness: 0.1, viaDiameter: 0.3, route: [start, end], vias: [] },
        { connectionName: "branch", rootConnectionName: sharedRoot ? "root" : "foreign", traceThickness: 0.2, viaDiameter: 0.3, route: [{ x: 0, y: -3, z: 0 }, { x: 0, y: 3, z: 0 }], vias: [] },
      ],
      routeIndex: 0, start, end, bounds, traceThickness: 0.1,
      traceClearance: 0.1, viaClearance: 0.1, allowLayerChanges: false, maxNodes: 1000,
    }
    const solver = new FindClearancePathSolver(input)
    while (!solver.solved && !solver.failed) solver.step()
    expect(solver.failed).toBe(false)
    expect(Boolean(solver.getOutput())).toBe(sharedRoot)
    if (sharedRoot) expect(solver.getOutput()).toEqual([start, end])
    else expect(solver.stats.completionReason).toBe("no-path")
    expect((solver.stats as typeof solver.stats & { corridorEdgeChecks: number }).corridorEdgeChecks).toBeGreaterThan(0)
  }
  for (const endZ of [0, 1]) {
    const padEnd = { ...end, z: endZ }
    const solver = new FindClearancePathSolver({
      srj: {
        bounds, layerCount: 2, minTraceWidth: 0.1,
        connections: [{ name: "signal", pointsToConnect: [] }],
        obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 10, height: 10, layers: ["top", "bottom"], connectedTo: ["signal"] }],
      },
      routes: [{ connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3, route: [start, padEnd], vias: [] }],
      routeIndex: 0, start, end: padEnd, bounds, traceThickness: 0.1,
      traceClearance: 0.1, viaClearance: 0.1, maxNodes: 1000,
    })
    while (!solver.solved && !solver.failed) solver.step()
    expect(solver.failed).toBe(false)
    // An owned pad admits an electrical trace, but ownership cannot authorize
    // drilling a new via anywhere inside its physical copper footprint.
    expect(Boolean(solver.getOutput())).toBe(endZ === 0)
    expect(solver.stats.completionReason).toBe(endZ === 0 ? "found" : "no-path")
  }
})
