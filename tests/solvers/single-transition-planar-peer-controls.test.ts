import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  findSingleTransitionVia,
  type SingleTransitionBoardContext,
} from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import { SingleTransitionWithPlanarRoutesSolver } from "../../lib/solvers/HighDensitySolver/SingleTransitionWithPlanarRoutesSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../../lib/types/high-density-types"

type Point = { x: number; y: number }

const pointToSegmentDistance = (point: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  return Math.hypot(point.x - a.x - fraction * dx, point.y - a.y - fraction * dy)
}

test("board-aware transitions account for full-stack peer copper, exact margins, scale and ownership", () => {
  const start: PortPoint = { x: -0.4, y: 0.3, z: 5, connectionName: "transition" }
  const end: PortPoint = { x: 0.4, y: 0, z: 7, connectionName: "transition" }
  const peer: HighDensityIntraNodeRoute = {
    connectionName: "foreign",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [{ x: -0.4, y: 0, z: 0 }, { x: 0.4, y: 0, z: 0 }],
    vias: [],
  }
  const context: SingleTransitionBoardContext = {
    obstacles: [], layerCount: 8, allowBlindAndBuriedVias: false,
    viaToPadClearance: 0.1, traceToPadClearance: 0.1,
    traceToHoleClearance: 0.2, coordinateScale: 1,
    boardGeometry: { bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 } },
    planarRoutes: [peer],
  }
  const input = {
    nominal: { x: end.x, y: end.y }, start, end,
    connectionName: "transition", center: { x: 0, y: 0 },
    viaDiameter: 0.3, traceThickness: 0.1, context,
  }
  const before = JSON.stringify(input)
  const via = findSingleTransitionVia(input)
  expect(via).toBeDefined()
  expect(pointToSegmentDistance(via!, peer.route[0]!, peer.route[1]!)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  expect(JSON.stringify(input)).toBe(before)

  // A full through barrel intersects these planes even when neither wire leg does.
  for (const z of [0, 1, 4, 6]) {
    const onLayer = { ...peer, route: peer.route.map((point) => ({ ...point, z })) }
    const candidate = findSingleTransitionVia({ ...input, context: { ...context, planarRoutes: [onLayer] } })
    expect(candidate).toBeDefined()
    expect(pointToSegmentDistance(candidate!, onLayer.route[0]!, onLayer.route[1]!)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  }

  const blind = findSingleTransitionVia({ ...input, context: { ...context, allowBlindAndBuriedVias: true } })
  expect(blind).toEqual(input.nominal)
  const own = findSingleTransitionVia({ ...input, context: { ...context,
    planarRoutes: [{ ...peer, connectionName: "transition" }] } })
  expect(own).toEqual(input.nominal)
  const connMap = new ConnectivityMap({
    connectivity_net_0: ["transition", "peerAlias"],
    connectivity_net_1: ["foreign", "connectivity_net_0"],
  })
  expect(findSingleTransitionVia({ ...input, context: { ...context, connMap,
    planarRoutes: [{ ...peer, connectionName: "peerAlias" }] } })).toEqual(input.nominal)
  const canonicalRoot = { ...start, connectionName: "unknownBranch", rootConnectionName: "connectivity_net_0" }
  expect(findSingleTransitionVia({ ...input, start: canonicalRoot, connectionName: "unknownBranch",
    context: { ...context, connMap, planarRoutes: [{ ...peer, connectionName: "peerAlias" }] } })).toEqual(input.nominal)
  const explicitForeignCanonicalRoot = findSingleTransitionVia({ ...input,
    start: { ...start, rootConnectionName: "connectivity_net_0" },
    context: { ...context, connMap, planarRoutes: [{ ...peer,
      connectionName: "peerAlias", rootConnectionName: "connectivity_net_1" }] } })
  expect(explicitForeignCanonicalRoot).toBeDefined()
  expect(pointToSegmentDistance(explicitForeignCanonicalRoot!, peer.route[0]!, peer.route[1]!)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  const foreignDespiteRoot = findSingleTransitionVia({ ...input, context: { ...context, connMap,
    planarRoutes: [{ ...peer, rootConnectionName: "transition" }] } })
  expect(foreignDespiteRoot).toBeDefined()
  expect(pointToSegmentDistance(foreignDespiteRoot!, peer.route[0]!, peer.route[1]!)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  for (const clearance of [0, 0.2]) {
    const candidate = findSingleTransitionVia({ ...input, context: { ...context, traceToPadClearance: clearance } })
    expect(candidate).toBeDefined()
    expect(pointToSegmentDistance(candidate!, peer.route[0]!, peer.route[1]!)).toBeGreaterThanOrEqual(0.2 + clearance - 1e-9)
  }

  // The foreign wire is above the barrel's physical span only in blind-via mode.
  const innerPeer = { ...peer, route: peer.route.map((point) => ({ ...point, z: 6 })) }
  const blindInner = findSingleTransitionVia({ ...input, context: {
    ...context, allowBlindAndBuriedVias: true, planarRoutes: [innerPeer] } })
  expect(blindInner).toBeDefined()
  expect(pointToSegmentDistance(blindInner!, innerPeer.route[0]!, innerPeer.route[1]!)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  const endPeer = { ...peer, route: peer.route.map((point) => ({ ...point, z: 7 })) }
  expect(findSingleTransitionVia({ ...input,
    context: { ...context, planarRoutes: [endPeer] } })).toBeUndefined()

  // Wire legs must also clear a peer on their own plane, not just the via center.
  const wall = { ...peer, route: [{ x: 0, y: -2, z: 5 }, { x: 0, y: 2, z: 5 }] }
  const leftStart = { ...start, y: 0 }
  const leftVia = findSingleTransitionVia({ ...input, start: leftStart,
    context: { ...context, planarRoutes: [wall] } })
  expect(leftVia).toBeDefined()
  expect(leftVia!.x).toBeLessThanOrEqual(-0.3 + 1e-9)
  expect(pointToSegmentDistance(leftVia!, wall.route[0]!, wall.route[1]!)).toBeGreaterThanOrEqual(0.3 - 1e-9)

  // Non-origin scaling must preserve world-space copper sizes and the chosen world proposal.
  const center = { x: 10, y: 20 }
  const translated = <T extends Point>(point: T): T => ({ ...point, x: point.x + center.x, y: point.y + center.y })
  const scaled = <T extends Point>(point: T, factor: number): T => ({ ...point,
    x: center.x + (point.x - center.x) * factor, y: center.y + (point.y - center.y) * factor })
  const shiftedInput = { ...input, start: translated(start), end: translated(end),
    nominal: translated(input.nominal), center,
    context: { ...context, planarRoutes: [{ ...peer, route: peer.route.map(translated) }],
      boardGeometry: { bounds: { minX: 5, maxX: 15, minY: 15, maxY: 25 } } } }
  const shiftedVia = findSingleTransitionVia(shiftedInput)
  expect(shiftedVia).toBeDefined()
  for (const factor of [0.5, 2, 4]) {
    const scaledVia = findSingleTransitionVia({ ...shiftedInput,
      start: scaled(shiftedInput.start, factor), end: scaled(shiftedInput.end, factor), nominal: scaled(shiftedInput.nominal, factor),
      context: { ...shiftedInput.context, coordinateScale: factor,
        planarRoutes: [{ ...peer, route: shiftedInput.context.planarRoutes[0]!.route.map((point) => scaled(point, factor)) }] } })
    expect(scaledVia).toBeDefined()
    expect(center.x + (scaledVia!.x - center.x) / factor).toBeCloseTo(shiftedVia!.x, 9)
    expect(center.y + (scaledVia!.y - center.y) / factor).toBeCloseTo(shiftedVia!.y, 9)
  }
  expect(() => findSingleTransitionVia({ ...input, context: { ...context, coordinateScale: 0 } })).toThrow("Invalid transition coordinate scale")

  // No candidate may escape the actual board to evade the peer or a raw obstacle.
  const narrowBoard = { bounds: { minX: -0.45, maxX: 0.45, minY: -0.35, maxY: 0.35 } }
  expect(findSingleTransitionVia({ ...input, context: { ...context, boardGeometry: narrowBoard } })).toBeUndefined()
  const coveredBoard = { ...context, planarRoutes: [],
    boardGeometry: { bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } },
    obstacles: [{ type: "rect" as const, layers: ["top"], zLayers: [0], center: { x: 0, y: 0 },
      width: 10, height: 10, connectedTo: [] }] }
  expect(findSingleTransitionVia({ ...input, context: coveredBoard })).toBeUndefined()
  expect(findSingleTransitionVia({ ...input, context: { ...coveredBoard, allowBlindAndBuriedVias: true } })).toEqual(input.nominal)

  const planarPoints: PortPoint[] = peer.route.map((point) => ({ ...point, connectionName: peer.connectionName }))
  const node: NodeWithPortPoints = { capacityMeshNodeId: "generic-two-task", center: { x: 0, y: 0 },
    width: 1, height: 1, availableZ: Array.from({ length: 8 }, (_, z) => z),
    portPoints: [...planarPoints, start, end] }
  const family = new SingleTransitionWithPlanarRoutesSolver({ nodeWithPortPoints: node,
    viaDiameter: 0.3, traceThickness: 0.1, boardContext: { ...context, planarRoutes: [] } })
  family.solve()
  expect(family.solved).toBe(true)
  expect(family.failed).toBe(false)
  expect(family.solvedRoutes).toHaveLength(2)
  const transition = family.solvedRoutes.find((route) => route.connectionName === "transition")!
  expect(transition.vias).toHaveLength(1)
  expect(pointToSegmentDistance(transition.vias[0]!, peer.route[0]!, peer.route[1]!)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  const blocked = new SingleTransitionWithPlanarRoutesSolver({ nodeWithPortPoints: node,
    viaDiameter: 0.3, traceThickness: 0.1, boardContext: coveredBoard })
  blocked.solve()
  expect(blocked.solved).toBe(false)
  expect(blocked.failed).toBe(true)
  const crossingNode: NodeWithPortPoints = { ...node, portPoints: [...node.portPoints,
    { x: 0, y: -0.4, z: 0, connectionName: "secondForeign" },
    { x: 0, y: 0.4, z: 0, connectionName: "secondForeign" }] }
  const crossing = new SingleTransitionWithPlanarRoutesSolver({ nodeWithPortPoints: crossingNode,
    viaDiameter: 0.3, traceThickness: 0.1, boardContext: { ...context, planarRoutes: [] } })
  crossing.solve()
  expect(crossing.solved).toBe(false)
  expect(crossing.failed).toBe(true)
})
