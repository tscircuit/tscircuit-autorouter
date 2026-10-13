import {
  TraceSimplificationSolver,
  UselessViaRemovalSolver,
  type HighDensityRoute,
  type Obstacle,
} from "@tscircuit/trace-simplification-solver"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

test("via shortcuts keep board clearance", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "start" },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 3, y: 1, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0, pcb_port_id: "end" },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 3, y: 0 },
    ],
  }
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: 2, y: 1 },
    width: 1,
    height: 0.5,
    layers: ["top"],
    connectedTo: ["foreign"],
  }
  const outline = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 2, y: -0.25 },
    { x: 3, y: -1 },
    { x: 5, y: -1 },
    { x: 5, y: 2 },
    { x: -1, y: 2 },
  ]
  const getWireGap = (
    candidate: HighDensityRoute,
    polygon: Array<{ x: number; y: number }>,
  ): number => {
    let gap = Number.POSITIVE_INFINITY
    for (let index = 1; index < candidate.route.length; index++) {
      const a = candidate.route[index - 1]!
      const b = candidate.route[index]!
      if (a.z !== b.z) continue
      for (let edge = 0; edge < polygon.length; edge++) {
        gap = Math.min(
          gap,
          minimumDistanceBetweenSegments(
            a,
            b,
            polygon[edge]!,
            polygon[(edge + 1) % polygon.length]!,
          ) -
            candidate.traceThickness / 2,
        )
      }
    }
    return gap
  }
  const original = JSON.stringify({ route, obstacle, outline })
  const connMap = new ConnectivityMap({ signal_net: ["signal"] })
  const params: ConstructorParameters<typeof UselessViaRemovalSolver>[0] = {
    unsimplifiedHdRoutes: [route],
    obstacles: [obstacle],
    colorMap: {},
    layerCount: 2,
    connMap,
    outline,
    minBoardEdgeClearance: 0.3,
    enableGeometryShortcuts: true,
    preserveRouteEndpoints: true,
  }
  expect(getWireGap(route, outline)).toBeGreaterThanOrEqual(0.3)
  const solver = new UselessViaRemovalSolver(params)
  solver.solve()
  expect(solver.failed).toBeFalse()
  const guarded = solver.getOptimizedHdRoutes()![0]!
  expect(getWireGap(guarded, outline)).toBeGreaterThanOrEqual(0.3)
  expect(guarded.route[0]).toEqual(route.route[0])
  expect(guarded.route.at(-1)).toEqual(route.route.at(-1))
  expect(guarded.traceThickness).toBe(0.15)
  expect(guarded.vias).toHaveLength(2)

  const legacy = new UselessViaRemovalSolver({
    ...params,
    minBoardEdgeClearance: undefined,
  })
  legacy.solve()
  const legacyOutput = legacy.getOptimizedHdRoutes()![0]!
  expect(legacyOutput.vias).toHaveLength(0)
  expect(getWireGap(legacyOutput, outline)).toBeLessThan(0.3)
  expect(legacyOutput.route[0]).toEqual(route.route[0])
  expect(legacyOutput.route.at(-1)).toEqual(route.route.at(-1))

  const safeOutline = outline.map((point, index): { x: number; y: number } => ({
    ...point,
    y: index === 2 ? -0.6 : point.y,
  }))
  const safe = new UselessViaRemovalSolver({ ...params, outline: safeOutline })
  safe.solve()
  const safeOutput = safe.getOptimizedHdRoutes()![0]!
  expect(safeOutput.vias).toHaveLength(0)
  expect(getWireGap(safeOutput, safeOutline)).toBeGreaterThanOrEqual(0.3)
  expect(safeOutput.route[0]).toEqual(route.route[0])
  expect(safeOutput.route.at(-1)).toEqual(route.route.at(-1))

  const pipeline = new TraceSimplificationSolver({
    hdRoutes: [route],
    obstacles: [obstacle],
    connMap,
    colorMap: {},
    outline,
    defaultViaDiameter: 0.3,
    layerCount: 2,
    minBoardEdgeClearance: 0.3,
    preserveRouteEndpoints: true,
  })
  pipeline.step()
  const viaRemoval = pipeline.activeSubSolver
  if (!(viaRemoval instanceof UselessViaRemovalSolver)) {
    throw new Error("Expected the existing via-removal simplification phase")
  }
  viaRemoval.step()
  const single = viaRemoval.activeSubSolver
  if (!single) throw new Error("Expected one original routed trace")
  expect(single.getConstructorParams().minBoardEdgeClearance).toBe(0.3)
  expect(JSON.stringify({ route, obstacle, outline })).toBe(original)
})
