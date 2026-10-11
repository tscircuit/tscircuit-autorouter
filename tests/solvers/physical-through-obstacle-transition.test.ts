import { expect, test } from "bun:test"
import type { Obstacle } from "../../lib/types"
import type { NodeWithPortPoints, HighDensityRoute } from "../../lib/types/high-density-types"
import { pointInsideObstacleCopper } from "../../lib/utils/pointInsideObstacleCopper"
import { convertHdRouteToSimplifiedRoute } from "../../lib/utils/convertHdRouteToSimplifiedRoute"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "../../lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { addApproximatingRectsToSrj } from "../../lib/utils/addApproximatingRectsToSrj"
import { scalePhysicalCopperObstacles } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/scalePhysicalCopperObstacles"
import { PhysicalTraceSimplificationSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PhysicalTraceSimplificationSolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

test("physical obstacle transitions use circular and rotated copper instead of bounding boxes", (): void => {
  const obstacle = { type: "oval", center: { x: -18, y: 18 }, width: 6, height: 6,
    layers: ["top", "inner1", "inner2", "bottom"], connectedTo: ["signal"],
    circuitJsonMetadata: { pcb_plated_hole_id: "hole" } } as unknown as Obstacle
  const corner = { x: -15.187, y: 15.151 }
  expect(pointInsideObstacleCopper(corner, obstacle)).toBe(false)
  expect(pointInsideObstacleCopper({ x: -15, y: 18 }, obstacle, 0)).toBe(true)
  expect(pointInsideObstacleCopper({ x: -15 + 1e-5, y: 18 }, obstacle)).toBe(false)
  const pill = { ...obstacle, center: { x: 0, y: 0 }, width: 6, height: 2, ccwRotationDegrees: 90 }
  expect(pointInsideObstacleCopper({ x: 0, y: 2.9 }, pill)).toBe(true)
  expect(pointInsideObstacleCopper({ x: 2.9, y: 0 }, pill)).toBe(false)
  expect(pointInsideObstacleCopper({ x: 1, y: 2 }, pill, 0)).toBe(true)
  expect(pointInsideObstacleCopper({ x: 1, y: 2.1 }, pill)).toBe(false)
  const rect = { ...pill, type: "rect" as const }
  expect(pointInsideObstacleCopper({ x: .9, y: 2.9 }, rect)).toBe(true)
  expect(pointInsideObstacleCopper({ x: 2.9, y: .9 }, rect)).toBe(false)
  expect(pointInsideObstacleCopper({ x: NaN, y: 0 }, obstacle)).toBe(false)
  const node: NodeWithPortPoints = { capacityMeshNodeId: "transition", center: corner, width: .5, height: .5,
    portPoints: [0, 1].map((z) => ({ ...corner, z, connectionName: "signal" })) }
  const original = new SingleTransitionThroughObstacleIntraNodeSolver({ nodeWithPortPoints: node,
    obstacles: [obstacle], layerCount: 4 })
  const physical = new SingleTransitionThroughObstacleIntraNodeSolver({ nodeWithPortPoints: node,
    obstacles: [obstacle], layerCount: 4, requirePhysicalCopper: true })
  expect(original.solved).toBe(true)
  expect(physical.failed).toBe(true)
  const originalObstacle = structuredClone(obstacle)
  const normalized = addApproximatingRectsToSrj({ layerCount: 4, minTraceWidth: .15,
    bounds: { minX: -30, maxX: 30, minY: -30, maxY: 30 }, connections: [], obstacles: [obstacle] }, { preserveCopperGeometry: true })
  const approximation = normalized.obstacles[0]!
  expect(approximation.type).toBe("rect")
  expect(approximation.copperGeometry?.type).toBe("oval")
  expect(pointInsideObstacleCopper(corner, approximation)).toBe(false)
  const normalizedPhysical = new SingleTransitionThroughObstacleIntraNodeSolver({ nodeWithPortPoints: node,
    obstacles: [approximation], layerCount: 4, requirePhysicalCopper: true })
  expect(normalizedPhysical.failed).toBe(true)
  expect(obstacle).toEqual(originalObstacle)
  const growthCenter = { x: -15, y: 15 }
  for (const factor of [1, 2, 4, 8, 16, 32]) {
    const scaled = scalePhysicalCopperObstacles([approximation], growthCenter, factor)[0]!
    for (const point of [corner, obstacle.center, { x: -15, y: 18 }]) {
      const scaledPoint = { x: growthCenter.x + (point.x - growthCenter.x) * factor,
        y: growthCenter.y + (point.y - growthCenter.y) * factor }
      expect(pointInsideObstacleCopper(scaledPoint, scaled, 0)).toBe(pointInsideObstacleCopper(point, approximation, 0))
    }
  }
  const viaRoute: HighDensityRoute = { connectionName: "signal", traceThickness: .15, viaDiameter: .3,
    route: [0, 1].map((z) => ({ ...corner, z })), vias: [corner] }
  const output = convertHdRouteToSimplifiedRoute(viaRoute, 4, { connectedMultilayerObstacles: [approximation] })
  expect(output.filter((point) => point.route_type === "via")).toHaveLength(1)
  expect(output.some((point) => point.route_type === "through_obstacle")).toBe(false)
  const centeredNode = { ...node, portPoints: node.portPoints.map((point) => ({ ...point, ...obstacle.center })) }
  const centered = new SingleTransitionThroughObstacleIntraNodeSolver({ nodeWithPortPoints: centeredNode,
    obstacles: [obstacle], layerCount: 4, requirePhysicalCopper: true })
  expect(centered.solved).toBe(true)
  expect(centered.solvedRoutes[0]!.route[0]!.toNextSegmentType).toBe("through_obstacle")
  const circle: Obstacle = { type: "rect", shape: "circle", center: { x: 0, y: 0 }, width: 6, height: 6,
    layers: ["top", "bottom"], connectedTo: ["signal"] }
  const circleSrj = { layerCount: 2, minTraceWidth: .15,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 }, connections: [], obstacles: [circle] }
  const legacyCircle = addApproximatingRectsToSrj(circleSrj).obstacles[0]!
  const physicalCircle = addApproximatingRectsToSrj(circleSrj, { preserveCopperGeometry: true }).obstacles[0]!
  expect(legacyCircle.copperGeometry).toBeUndefined()
  expect(physicalCircle.copperGeometry).toMatchObject({ type: "rect", shape: "circle", center: circle.center, width: 6, height: 6 })
  expect(circle.copperGeometry).toBeUndefined()
  const circleCorner = { x: 2.8, y: 2.8 }
  const circleVia: HighDensityRoute = { connectionName: "signal", traceThickness: .15, viaDiameter: .3,
    route: [0, 1].map((z) => ({ ...circleCorner, z })), vias: [circleCorner] }
  const connMap = new ConnectivityMap({ root: ["signal"] })
  const simplifiedCircle = new PhysicalTraceSimplificationSolver({ hdRoutes: [circleVia], obstacles: [physicalCircle],
    connMap, colorMap: {}, defaultViaDiameter: .3, layerCount: 2, requirePhysicalCopperTransitions: true })
  expect(simplifiedCircle.hdRoutes[0]!.vias).toHaveLength(1)
  for (const options of [{ connectedMultilayerObstacles: [physicalCircle] }, { obstacles: [physicalCircle], connMap }]) {
    const converted = convertHdRouteToSimplifiedRoute(simplifiedCircle.hdRoutes[0]!, 2, options)
    expect(converted.filter((point) => point.route_type === "via")).toHaveLength(1)
    expect(converted.some((point) => point.route_type === "through_obstacle")).toBe(false)
    const invalidTagged = { ...circleVia, route: circleVia.route.map((point, index) => index === 0
      ? { ...point, toNextSegmentType: "through_obstacle" as const } : point) }
    const revalidated = convertHdRouteToSimplifiedRoute(invalidTagged, 2, options)
    expect(revalidated.filter((point) => point.route_type === "via")).toHaveLength(1)
    expect(revalidated.some((point) => point.route_type === "through_obstacle")).toBe(false)
    expect(() => convertHdRouteToSimplifiedRoute({ ...invalidTagged, vias: [] }, 2, options))
      .toThrow("invalid through-obstacle transition")
  }
  expect(convertHdRouteToSimplifiedRoute(circleVia, 2, { connectedMultilayerObstacles: [legacyCircle] })
    .some((point) => point.route_type === "through_obstacle")).toBe(true)
  const contact = { x: 3.04, y: 0 }
  const attachedWire: HighDensityRoute = { connectionName: "signal", traceThickness: .02, viaDiameter: .3,
    route: [{ x: 3.4, y: 0, z: 0, traceThickness: .12 }, { ...contact, z: 0, traceThickness: .02 },
      { ...contact, z: 1, traceThickness: .12 }, { x: 3.4, y: 0, z: 1 }], vias: [] }
  const taggedAttachedWire = { ...attachedWire, route: attachedWire.route.map((point, index) => index === 1
    ? { ...point, toNextSegmentType: "through_obstacle" as const } : point) }
  for (const options of [{ connectedMultilayerObstacles: [physicalCircle] }, { obstacles: [physicalCircle], connMap }]) {
    for (const route of [attachedWire, taggedAttachedWire]) {
      const converted = convertHdRouteToSimplifiedRoute(route, 2, options)
      expect(converted.filter((point) => point.route_type === "through_obstacle")).toHaveLength(1)
      expect(converted.some((point) => point.route_type === "via")).toBe(false)
    }
    const narrowIncoming = { ...taggedAttachedWire, vias: [contact],
      route: taggedAttachedWire.route.map((point, index) => index === 0 ? { ...point, traceThickness: .02 } : point) }
    const rejected = convertHdRouteToSimplifiedRoute(narrowIncoming, 2, options)
    expect(rejected.filter((point) => point.route_type === "via")).toHaveLength(1)
    expect(rejected.some((point) => point.route_type === "through_obstacle")).toBe(false)
    const nakedPoint = { ...taggedAttachedWire, route: taggedAttachedWire.route.slice(1, 3), vias: [contact] }
    expect(convertHdRouteToSimplifiedRoute(nakedPoint, 2, options)
      .filter((point) => point.route_type === "via")).toHaveLength(1)
  }
  const spanVia: HighDensityRoute = { connectionName: "signal", traceThickness: .15, viaDiameter: .3,
    route: [2, 3].map((z) => ({ x: 0, y: 0, z })), vias: [{ x: 0, y: 0 }] }
  const taggedSpanVia = { ...spanVia, route: spanVia.route.map((point, index) => index === 0
    ? { ...point, toNextSegmentType: "through_obstacle" as const } : point) }
  const plainRect: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 6, height: 6,
    layers: ["top", "inner1"], connectedTo: ["signal"] }
  const annotatedRect = addApproximatingRectsToSrj({ ...circleSrj, layerCount: 4, obstacles: [plainRect] },
    { preserveCopperGeometry: true }).obstacles[0]!
  expect(annotatedRect.copperGeometry).toMatchObject({ type: "rect", center: plainRect.center, width: 6, height: 6 })
  expect(plainRect.copperGeometry).toBeUndefined()
  const simplifiedSpan = new PhysicalTraceSimplificationSolver({ hdRoutes: [spanVia], obstacles: [annotatedRect],
    connMap, colorMap: {}, defaultViaDiameter: .3, layerCount: 4, requirePhysicalCopperTransitions: true })
  expect(simplifiedSpan.hdRoutes[0]!.vias).toHaveLength(1)
  for (const partialSpan of [annotatedRect, { ...annotatedRect, zLayers: [0, 1] },
    { ...annotatedRect, __zLayers: [0, 1], zLayers: [2, 3] },
    { ...annotatedRect, layers: ["top", "bottom"], __zLayers: [0, 3] }]) {
    for (const options of [{ connectedMultilayerObstacles: [partialSpan] }, { obstacles: [partialSpan], connMap }]) {
      const converted = convertHdRouteToSimplifiedRoute(spanVia, 4, options)
      expect(converted.filter((point) => point.route_type === "via")).toHaveLength(1)
      expect(converted.some((point) => point.route_type === "through_obstacle")).toBe(false)
      const revalidated = convertHdRouteToSimplifiedRoute(taggedSpanVia, 4, options)
      expect(revalidated.filter((point) => point.route_type === "via")).toHaveLength(1)
      expect(revalidated.some((point) => point.route_type === "through_obstacle")).toBe(false)
      expect(() => convertHdRouteToSimplifiedRoute({ ...taggedSpanVia, vias: [] }, 4, options))
        .toThrow("invalid through-obstacle transition")
    }
  }
  for (const fullSpan of [{ ...annotatedRect, layers: ["inner2", "bottom"] },
    { ...annotatedRect, zLayers: [2, 3] }, { ...annotatedRect, layers: ["top"], zLayers: [2, 3] },
    { ...annotatedRect, __zLayers: [2, 3], zLayers: [0, 1] }]) {
    for (const options of [{ connectedMultilayerObstacles: [fullSpan] }, { obstacles: [fullSpan], connMap }]) {
      expect(convertHdRouteToSimplifiedRoute(spanVia, 4, options)
        .some((point) => point.route_type === "through_obstacle")).toBe(true)
      expect(convertHdRouteToSimplifiedRoute(taggedSpanVia, 4, options)
        .some((point) => point.route_type === "through_obstacle")).toBe(true)
    }
  }
  const { copperGeometry: _copperGeometry, ...legacyPartialSpan } = annotatedRect
  for (const options of [{ connectedMultilayerObstacles: [legacyPartialSpan] }, { obstacles: [legacyPartialSpan], connMap }]) {
    expect(convertHdRouteToSimplifiedRoute(spanVia, 4, options)
      .some((point) => point.route_type === "through_obstacle")).toBe(true)
    expect(convertHdRouteToSimplifiedRoute(taggedSpanVia, 4, options)
      .some((point) => point.route_type === "through_obstacle")).toBe(true)
  }
})
