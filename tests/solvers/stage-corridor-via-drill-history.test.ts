import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/FindClearancePathSolver"
import type { CorridorPathInput } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createVisibilityCorridorSearch"

test("corridor vias enforce physical drill spacing while permitting exact same-site stack reuse", (): void => {
  const start = { x: -0.3, y: 0, z: 0 }, end = { x: 0.3, y: 0, z: 0 }
  const bounds = { minX: -0.4, maxX: 0.4, minY: -0.02, maxY: 0.02 }
  for (const viaHoleDiameter of [0.1, 0.4, undefined]) {
    const input: CorridorPathInput = {
      srj: {
        bounds, layerCount: 2, minTraceWidth: 0.05, connections: [], obstacles: [],
      },
      routes: [{ connectionName: "signal", traceThickness: 0.05, viaDiameter: 0.4, route: [start, end], vias: [] }],
      routeIndex: 0, start, end, bounds, traceThickness: 0.05,
      traceClearance: 0.01, viaClearance: 0.35, viaHoleDiameter, maxNodes: 1000,
      // A live occupied top corridor forces two transitions without adding
      // an annulus barrier that would independently separate the drill sites.
      getAdditionalEdgeCost: (a, b): number => a.z === 0 && b.z === 0 && a.x !== b.x ? Infinity : 0,
    }
    const solver = new FindClearancePathSolver(input)
    while (!solver.solved && !solver.failed) solver.step()
    expect(solver.failed).toBe(false)
    const path = solver.getOutput()
    expect(Boolean(path)).toBe(viaHoleDiameter === 0.1)
    if (!path) continue
    const vias = path.filter((point, index): boolean => index > 0 && path[index - 1]!.z !== point.z)
    expect(vias).toHaveLength(2)
    // These two distinct drills belong to ONE route/net, so an electrical
    // ownership exemption must not remove the hole-to-hole requirement.
    expect(Math.hypot(vias[0]!.x - vias[1]!.x, vias[0]!.y - vias[1]!.y)).toBeGreaterThanOrEqual(0.45 - 1e-8)
    expect(path[0]).toEqual(start)
    expect(path.at(-1)).toEqual(end)
  }
  const stackStart = { x: -1, y: 0, z: 0 }, stackEnd = { x: 1, y: 0, z: 2 }
  const stackBounds = { minX: -2, maxX: 2, minY: -1, maxY: 1 }
  const stack = new FindClearancePathSolver({
    srj: { bounds: stackBounds, layerCount: 3, minTraceWidth: 0.1, connections: [], obstacles: [] },
    routes: [{ connectionName: "stack", traceThickness: 0.1, viaDiameter: 0.3, route: [stackStart, stackEnd], vias: [] }],
    routeIndex: 0, start: stackStart, end: stackEnd, bounds: stackBounds,
    traceThickness: 0.1, traceClearance: 0.1, viaClearance: 10,
    getAdditionalEdgeCost: (a, b): number => Math.abs(a.z - b.z) === 2 ? Infinity : 0,
    maxNodes: 1000,
  })
  while (!stack.solved && !stack.failed) stack.step()
  expect(stack.failed).toBe(false)
  const path = stack.getOutput()
  expect(path).not.toBeNull()
  const vias = path!.filter((point, index): boolean => index > 0 && path![index - 1]!.z !== point.z)
  expect(vias).toHaveLength(2)
  expect(vias[0]!.x).toBe(vias[1]!.x)
  expect(vias[0]!.y).toBe(vias[1]!.y)
  expect(path![0]).toEqual(stackStart)
  expect(path!.at(-1)).toEqual(stackEnd)
})
