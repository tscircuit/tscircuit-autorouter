import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { findSingleTransitionVia, type SingleTransitionBoardContext } from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import { SingleTransitionWithPlanarRoutesSolver } from "../../lib/solvers/HighDensitySolver/SingleTransitionWithPlanarRoutesSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints, PortPoint } from "../../lib/types/high-density-types"

type Point = { x: number; y: number }

const pointSegmentDistance = (point: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

test("general board-aware transitions preserve through barrels, foreign fixed points and distinct via spacing rules", () => {
  const start: PortPoint = { x: -1, y: 0.5, z: 4, connectionName: "current" }
  const end: PortPoint = { x: 1, y: 0.5, z: 5, connectionName: "current" }
  const peer: HighDensityIntraNodeRoute = { connectionName: "peer", traceThickness: 0.1,
    viaDiameter: 0.3, route: [{ x: 0.35, y: 0, z: 0 }, { x: 0.35, y: 0, z: 1 }],
    vias: [{ x: 0.35, y: 0 }] }
  const context: SingleTransitionBoardContext = {
    obstacles: [], layerCount: 8, allowBlindAndBuriedVias: false,
    coordinateScale: 1, viaToPadClearance: 0, traceToPadClearance: 0.1,
    traceToHoleClearance: 0.2, viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    boardGeometry: { bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 } },
    routedPeerRoutes: [peer],
  }
  const input = { nominal: { x: 0, y: 0 }, start, end, connectionName: "current",
    center: { x: 0, y: 0 }, viaDiameter: 0.3, traceThickness: 0.1, context }
  const immutable = JSON.stringify(input)
  const via = findSingleTransitionVia(input)
  expect(via).toBeDefined()
  // Explicit zero via-to-PAD clearance cannot remove independent .1 via-to-VIA clearance.
  expect(Math.hypot(via!.x - 0.35, via!.y)).toBeGreaterThanOrEqual(0.4 - 1e-9)
  expect(pointSegmentDistance(peer.vias[0]!, start, via!)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  expect(pointSegmentDistance(peer.vias[0]!, end, via!)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  expect(JSON.stringify(input)).toBe(immutable)

  const drilled = findSingleTransitionVia({ ...input,
    context: { ...context, minViaHoleEdgeToViaHoleEdgeClearance: 0.6 } })
  expect(drilled).toBeDefined()
  expect(Math.hypot(drilled!.x - 0.35, drilled!.y)).toBeGreaterThanOrEqual(0.75 - 1e-9)

  // Logical 4->5 still creates a physical 0->7 barrel unless blind vias are explicitly enabled.
  const blind = findSingleTransitionVia({ ...input, context: { ...context, allowBlindAndBuriedVias: true } })
  expect(blind).toEqual(input.nominal)
  const spanning = { ...peer, route: [{ x: 0.35, y: 0, z: 2 }, { x: 0.35, y: 0, z: 7 }] }
  const blindOverlapping = findSingleTransitionVia({ ...input,
    context: { ...context, allowBlindAndBuriedVias: true, routedPeerRoutes: [spanning] } })
  expect(blindOverlapping).toBeDefined()
  expect(Math.hypot(blindOverlapping!.x - 0.35, blindOverlapping!.y)).toBeGreaterThanOrEqual(0.4 - 1e-9)

  const future: PortPoint = { x: 0, y: 0, z: 0, connectionName: "future" }
  const reserved = findSingleTransitionVia({ ...input,
    context: { ...context, routedPeerRoutes: [], mandatoryPortPoints: [future] } })
  expect(reserved).toBeDefined()
  expect(Math.hypot(reserved!.x, reserved!.y)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  expect(findSingleTransitionVia({ ...input, context: { ...context, allowBlindAndBuriedVias: true,
    routedPeerRoutes: [], mandatoryPortPoints: [future] } })).toEqual(input.nominal)
  const samePlanePoint = { ...future, z: 4 }
  const reservedLeg = findSingleTransitionVia({ ...input, context: { ...context,
    routedPeerRoutes: [], mandatoryPortPoints: [samePlanePoint] } })
  expect(reservedLeg).toBeDefined()
  expect(pointSegmentDistance(samePlanePoint, start, reservedLeg!)).toBeGreaterThanOrEqual(0.2 - 1e-9)

  const connMap = new ConnectivityMap({ "0": ["current", "sameAlias"], "1": ["0", "peer", "future"] })
  const canonicalStart = { ...start, rootConnectionName: "0" }
  const canonicalOwn = { ...peer, connectionName: "unknown", rootConnectionName: "0" }
  expect(findSingleTransitionVia({ ...input, start: canonicalStart,
    context: { ...context, connMap, routedPeerRoutes: [canonicalOwn] } })).toEqual(input.nominal)
  const canonicalForeign = { ...peer, connectionName: "sameAlias", rootConnectionName: "1" }
  const protectedForeign = findSingleTransitionVia({ ...input, start: canonicalStart,
    context: { ...context, connMap, routedPeerRoutes: [canonicalForeign] } })
  expect(protectedForeign).toBeDefined()
  expect(Math.hypot(protectedForeign!.x - 0.35, protectedForeign!.y)).toBeGreaterThanOrEqual(0.4 - 1e-9)
  const protectedFuture = findSingleTransitionVia({ ...input, start: canonicalStart,
    context: { ...context, connMap, routedPeerRoutes: [],
      mandatoryPortPoints: [{ ...future, connectionName: "sameAlias", rootConnectionName: "1" }] } })
  expect(protectedFuture).toBeDefined()
  expect(Math.hypot(protectedFuture!.x, protectedFuture!.y)).toBeGreaterThanOrEqual(0.3 - 1e-9)

  const center = { x: 10, y: 20 }
  const transform = <T extends Point>(point: T, scale: number): T => ({ ...point,
    x: center.x + point.x * scale, y: center.y + point.y * scale })
  for (const scale of [0.5, 2]) {
    const scaledPeer = { ...peer, route: peer.route.map((point) => transform(point, scale)),
      vias: peer.vias.map((point) => transform(point, scale)) }
    const scaled = findSingleTransitionVia({ ...input, center,
      nominal: transform(input.nominal, scale), start: transform(start, scale), end: transform(end, scale),
      context: { ...context, coordinateScale: scale, routedPeerRoutes: [scaledPeer],
        boardGeometry: { bounds: { minX: 5, maxX: 15, minY: 15, maxY: 25 } } } })
    expect(scaled).toBeDefined()
    expect(center.x + (scaled!.x - center.x) / scale).toBeCloseTo(center.x + via!.x, 9)
    expect(center.y + (scaled!.y - center.y) / scale).toBeCloseTo(center.y + via!.y, 9)
  }

  const points: PortPoint[] = [
    { x: -1, y: -0.5, z: 4, connectionName: "first" },
    { x: 1, y: -0.5, z: 5, connectionName: "first" },
    { x: -1, y: 0.5, z: 2, connectionName: "second" },
    { x: 1, y: 0.5, z: 7, connectionName: "second" },
  ]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "two-transition-generic", center: { x: 0, y: 0 },
    width: 4, height: 3, availableZ: Array.from({ length: 8 }, (_, z) => z), portPoints: points }
  const family = new SingleTransitionWithPlanarRoutesSolver({ nodeWithPortPoints: node,
    traceThickness: 0.1, viaDiameter: 0.3, boardContext: { ...context, routedPeerRoutes: [] } })
  family.solve()
  expect(family.solved).toBe(true)
  expect(family.failed).toBe(false)
  expect(family.solvedRoutes).toHaveLength(2)
  expect(family.solvedRoutes.every((route) => route.vias.length === 1)).toBe(true)
  const [first, second] = family.solvedRoutes
  expect(Math.hypot(first!.vias[0]!.x - second!.vias[0]!.x,
    first!.vias[0]!.y - second!.vias[0]!.y)).toBeGreaterThanOrEqual(0.4 - 1e-9)
  for (const route of family.solvedRoutes) {
    const terminals = points.filter((point) => point.connectionName === route.connectionName)
    expect(route.route[0]).toEqual({ x: terminals[0]!.x, y: terminals[0]!.y, z: terminals[0]!.z })
    expect(route.route.at(-1)).toEqual({ x: terminals[1]!.x, y: terminals[1]!.y, z: terminals[1]!.z })
  }
  const planarPeerNode: NodeWithPortPoints = { ...node, portPoints: [
    { x: -1, y: 0, z: 0, connectionName: "newPlanar" },
    { x: 1, y: 0, z: 0, connectionName: "newPlanar" },
    { x: -1, y: 2, z: 4, connectionName: "farTransition" },
    { x: 1, y: 2, z: 5, connectionName: "farTransition" },
  ] }
  const throughPlanar: HighDensityIntraNodeRoute = { ...peer,
    route: [{ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 7 }], vias: [{ x: 0, y: 0 }] }
  const collidingPlanar = new SingleTransitionWithPlanarRoutesSolver({ nodeWithPortPoints: planarPeerNode,
    traceThickness: 0.1, viaDiameter: 0.3, boardContext: { ...context,
      routedPeerRoutes: [throughPlanar] } })
  collidingPlanar.solve()
  expect(collidingPlanar.solved).toBe(false)
  expect(collidingPlanar.failed).toBe(true)
})
