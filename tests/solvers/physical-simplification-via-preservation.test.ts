import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { PhysicalTraceSimplificationSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PhysicalTraceSimplificationSolver"
import { PhysicalEffortCleanupSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PhysicalEffortCleanupSolver"
import type { Obstacle } from "../../lib/types"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "../../lib/utils/convertHdRouteToSimplifiedRoute"
import { markPhysicalCopperTransitions } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/markPhysicalCopperTransitions"
import { applyDrcErrorForces, cloneRoutes, materializeRoutes } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { pointToObstacleCopperDistance } from "../../lib/utils/pointToObstacleCopperDistance"
import { routePointTouchesObstacleCopper } from "../../lib/utils/routePointTouchesObstacleCopper"

test("physical simplification retains and restores real vias beyond circular copper at every phase", (): void => {
  const corner = { x: -15.187, y: 15.151 }
  const obstacle: Obstacle = { type: "rect", center: { x: -18, y: 18 }, width: 6, height: 6,
    layers: ["top", "inner1", "inner2", "bottom"], connectedTo: ["signal"],
    copperGeometry: { type: "oval", center: { x: -18, y: 18 }, width: 6, height: 6 },
    circuitJsonMetadata: { pcb_plated_hole_id: "hole" } }
  const input: HighDensityRoute = { connectionName: "signal", traceThickness: .15, viaDiameter: .3,
    route: [{ x: corner.x + .5, y: corner.y, z: 0 }, { ...corner, z: 0 },
      { ...corner, z: 1 }, { x: corner.x, y: corner.y - .5, z: 1 }], vias: [corner] }
  const config = { hdRoutes: [input], obstacles: [obstacle],
    connMap: new ConnectivityMap({ net: ["signal"] }), colorMap: { signal: "#f00" },
    defaultViaDiameter: .3, layerCount: 4, preserveRouteEndpoints: true }
  const original = structuredClone(input)
  const baseline = new TraceSimplificationSolver(config)
  expect(baseline.hdRoutes[0]!.vias).toHaveLength(0)
  expect(baseline.hdRoutes[0]!.route[1]!.toNextSegmentType).toBe("through_obstacle")
  const defaultAdapter = new PhysicalTraceSimplificationSolver(config)
  expect(defaultAdapter.hdRoutes).toEqual(baseline.hdRoutes)
  const physical = new PhysicalTraceSimplificationSolver({ ...config, requirePhysicalCopperTransitions: true })
  expect(physical.hdRoutes[0]!.vias).toEqual([corner])
  expect(physical.hdRoutes[0]!.route.some((point) => point.toNextSegmentType)).toBe(false)
  const restored = physical.markThroughObstacleSegments(baseline.hdRoutes)
  expect(restored[0]!.vias).toEqual([corner])
  expect(restored[0]!.route.some((point) => point.toNextSegmentType)).toBe(false)
  physical.solve()
  expect(physical.solved).toBe(true)
  expect(physical.hdRoutes[0]!.vias).toHaveLength(1)
  expect(convertHdRouteToSimplifiedRoute(physical.hdRoutes[0]!, 4, {
    connectedMultilayerObstacles: [obstacle],
  }).filter((point) => point.route_type === "via")).toHaveLength(1)
  expect(input).toEqual(original)
  const centered = { ...input, route: [{ ...obstacle.center, z: 0 }, { ...obstacle.center, z: 1 }],
    vias: [{ ...obstacle.center }] }
  const validBarrel = physical.markThroughObstacleSegments([centered])[0]!
  expect(validBarrel.route[0]!.toNextSegmentType).toBe("through_obstacle")
  expect(validBarrel.vias).toHaveLength(0)
  const cleanup = new PhysicalEffortCleanupSolver({ config, effort: 1.5,
    getCost: (routes) => ({ vias: routes.reduce((sum, route) => sum + route.vias.length, 0),
      points: routes.reduce((sum, route) => sum + route.route.length, 0) }), isValid: () => true })
  expect(cleanup.simplifier).toBeInstanceOf(PhysicalTraceSimplificationSolver)
  expect(cleanup.simplifier!.hdRoutes[0]!.vias).toHaveLength(1)

  // A later ordinary DRC repair preserves a marker while translating its points
  // outside the original barrel; its materializer intentionally derives no via.
  const circle: Obstacle = { ...obstacle, center: { x: 0, y: 0 }, layers: ["top", "bottom"],
    copperGeometry: { type: "oval", center: { x: 0, y: 0 }, width: 6, height: 6 } }
  const validBeforeRepair: HighDensityRoute = { ...input, vias: [],
    route: [{ x: 0, y: 0, z: 0 }, { x: 2.99, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
      { x: 2.99, y: 0, z: 1 }, { x: 4, y: 0, z: 1 }] }
  const repairSrj = { layerCount: 2, minTraceWidth: .15,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 }, connections: [{ name: "signal",
      pointsToConnect: [{ x: 0, y: 0, layer: "top" }, { x: 4, y: 0, layer: "bottom" }] }],
    obstacles: [circle, { type: "rect" as const, center: { x: 2.3, y: 0 }, width: 1, height: 1,
      layers: ["top"], connectedTo: ["foreign"] }] }
  const movable = cloneRoutes([validBeforeRepair])
  expect(applyDrcErrorForces(repairSrj, movable, [{ type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "signal_0", center: { x: 2.99, y: 0 }, message: "pcb_trace clearance pcb_smtpad" }],
  new Map([["signal_0", 0]]), 1)).toBe(true)
  const moved = materializeRoutes(movable)[0]!
  expect(moved.route[1]!.toNextSegmentType).toBe("through_obstacle")
  expect(moved.vias).toHaveLength(0)
  expect(Math.hypot(moved.route[1]!.x, moved.route[1]!.y)).toBeGreaterThan(3)
  const beforeFinalNormalization = structuredClone(moved)
  const finalConfig = { ...config, hdRoutes: [moved], obstacles: [circle], layerCount: 2 }
  const finalCleanup = new PhysicalEffortCleanupSolver({ config: finalConfig, effort: 1,
    getCost: (routes) => ({ vias: routes.reduce((sum, route) => sum +
      convertHdRouteToSimplifiedRoute(route, 2, { connectedMultilayerObstacles: [circle] })
        .filter((point) => point.route_type === "via").length, 0), points: 0 }), isValid: () => true })
  expect(finalCleanup.solved).toBe(true)
  expect(finalCleanup.simplifier).toBeUndefined()
  expect(finalCleanup.getOutput()[0]!.vias).toHaveLength(1)
  expect(finalCleanup.getOutput()[0]!.route.some((point) => point.toNextSegmentType)).toBe(false)
  expect(finalCleanup.bestCost.vias).toBe(1)
  expect(moved).toEqual(beforeFinalNormalization)
  expect(markPhysicalCopperTransitions(finalCleanup.getOutput(), finalConfig)).toEqual(finalCleanup.getOutput())

  const insideSpan: HighDensityRoute = { ...centered, route: [1, 2].map((z) => ({ ...obstacle.center, z })) }
  const outsideSpan: HighDensityRoute = { ...insideSpan, route: [0, 3].map((z) => ({ ...obstacle.center, z })) }
  for (const span of [
    { layers: ["top", "bottom"], __zLayers: [2, 1, 2, -1, 8], zLayers: [0, 3] },
    { layers: ["top"], zLayers: [1, 2] },
    { layers: ["inner1", "inner2"] },
  ]) {
    const spanObstacle = { ...obstacle, ...span }
    const spanConfig = { ...config, hdRoutes: [insideSpan], obstacles: [spanObstacle],
      requirePhysicalCopperTransitions: true }
    const spanSolver = new PhysicalTraceSimplificationSolver(spanConfig)
    expect(spanSolver.hdRoutes[0]!.route[0]!.toNextSegmentType).toBe("through_obstacle")
    expect(spanSolver.hdRoutes[0]!.vias).toHaveLength(0)
    const withOutsideSpan = new PhysicalTraceSimplificationSolver({ ...spanConfig, hdRoutes: [outsideSpan] })
    expect(withOutsideSpan.hdRoutes[0]!.route.some((point) => point.toNextSegmentType)).toBe(false)
    expect(withOutsideSpan.hdRoutes[0]!.vias).toEqual([{ ...obstacle.center }])
    const spanCleanup = new PhysicalEffortCleanupSolver({ config: spanConfig, effort: 1,
      getCost: () => ({ vias: 0, points: 0 }), isValid: () => true })
    expect(spanCleanup.getOutput()).toEqual(spanSolver.hdRoutes)
  }
  for (const span of [{ __zLayers: [] }, { __zLayers: [-1, 8] }, { zLayers: [] }]) {
    const spanSolver = new PhysicalTraceSimplificationSolver({ ...config,
      hdRoutes: [insideSpan], obstacles: [{ ...obstacle, ...span }], requirePhysicalCopperTransitions: true })
    expect(spanSolver.hdRoutes[0]!.route.some((point) => point.toNextSegmentType)).toBe(false)
    expect(spanSolver.hdRoutes[0]!.vias).toEqual([{ ...obstacle.center }])
  }
  const noncolocated: HighDensityRoute = { ...moved, route: moved.route.map((point, index) =>
    index === 2 ? { ...point, x: point.x + .01 } : { ...point }) }
  expect(() => new PhysicalEffortCleanupSolver({ config: { ...finalConfig, hdRoutes: [noncolocated] }, effort: 1,
    getCost: () => ({ vias: 0, points: 0 }), isValid: () => true })).toThrow("noncolocated layer change")

  // Repair01 rounds a legitimate barrel endpoint to 0.001mm. Its attached
  // outgoing copper still intersects the original rectangle after that rounding.
  const roundedRect: Obstacle = { ...obstacle, center: { x: 0, y: 0 }, width: 1.05, height: 2.1,
    copperGeometry: { type: "rect", center: { x: 0, y: 0 }, width: 1.05, height: 2.1 } }
  const rounded: HighDensityRoute = { ...input, traceThickness: .1, vias: [], route: [
    { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
    { x: .525115, y: -.18, z: 3 }, { x: 1.1, y: -.6, z: 3 },
  ] }
  expect(pointToObstacleCopperDistance(rounded.route[1]!, roundedRect)).toBeCloseTo(.000115, 12)
  expect(routePointTouchesObstacleCopper(rounded, 1, roundedRect)).toBe(true)
  const roundedMarked = markPhysicalCopperTransitions([rounded], { ...config, obstacles: [roundedRect] })[0]!
  expect(roundedMarked.route[0]!.toNextSegmentType).toBe("through_obstacle")
  expect(roundedMarked.vias).toHaveLength(0)
  const naked: HighDensityRoute = { ...rounded, route: rounded.route.slice(0, 2) }
  expect(routePointTouchesObstacleCopper(naked, 1, roundedRect)).toBe(false)
  expect(() => markPhysicalCopperTransitions([naked], { ...config, obstacles: [roundedRect] }))
    .toThrow("noncolocated layer change")

  const varyingWidth: HighDensityRoute = { ...rounded, route: [
    { x: .8, y: 0, z: 3, traceThickness: .1 },
    { x: .58, y: 0, z: 3, traceThickness: 1, toNextSegmentType: "through_obstacle" },
    { x: 0, y: 0, z: 0 },
  ] }
  expect(routePointTouchesObstacleCopper(varyingWidth, 1, roundedRect)).toBe(false)
  const thickerIncoming = { ...varyingWidth,
    route: varyingWidth.route.map((point, index) => index === 0 ? { ...point, traceThickness: .2 } : point) }
  expect(routePointTouchesObstacleCopper(thickerIncoming, 1, roundedRect)).toBe(true)
  const rotated: Obstacle = { ...roundedRect, width: 2, height: 2,
    copperGeometry: { type: "rect", center: { x: 0, y: 0 }, width: 2, height: 2, ccwRotationDegrees: 45 } }
  const diagonal = { x: 0, y: Math.sqrt(2) * 1.04 }
  expect(pointToObstacleCopperDistance(diagonal, rotated)).toBeCloseTo(Math.sqrt(2) * .04, 12)
  const diagonalRoute: HighDensityRoute = { ...rounded, route: [
    { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
    { ...diagonal, z: 3 }, { x: 0, y: 2, z: 3 },
  ] }
  expect(routePointTouchesObstacleCopper(diagonalRoute, 1, rotated)).toBe(false)
  const pill: Obstacle = { ...rotated,
    copperGeometry: { type: "oval", center: { x: 0, y: 0 }, width: 6, height: 2, ccwRotationDegrees: 90 } }
  expect(pointToObstacleCopperDistance({ x: 1.04, y: 2 }, pill)).toBeCloseTo(.04, 12)
  expect(pointToObstacleCopperDistance({ x: 1.04, y: 2.04 }, pill)).toBeCloseTo(Math.hypot(.04, 1.04) - 1, 12)
  const circleCorner: HighDensityRoute = { ...rounded, route: [
    { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
    { x: 2.8, y: 2.8, z: 3 }, { x: 4, y: 4, z: 3 },
  ] }
  expect(routePointTouchesObstacleCopper(circleCorner, 1, circle)).toBe(false)
  expect(() => markPhysicalCopperTransitions([circleCorner], { ...config, obstacles: [circle] }))
    .toThrow("noncolocated layer change")
  expect(pointToObstacleCopperDistance({ x: NaN, y: 0 }, circle)).toBe(Infinity)
  expect(pointToObstacleCopperDistance({ x: 0, y: 0 }, { ...circle, copperGeometry: undefined, width: 0 }))
    .toBe(Infinity)
})
