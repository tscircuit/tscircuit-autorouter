import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { findSingleTransitionVia, areSingleTransitionPlanarRoutesClear, type SingleTransitionBoardContext } from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import { CompletedCopperWorldIndex, areRoutesClearOfCompletedCopper } from "../../lib/solvers/HighDensitySolver/completedCopperWorldIndex"
import type { HighDensityIntraNodeRoute, PortPoint } from "../../lib/types/high-density-types"

test("finite transitions choose safe WORLD ledger alternatives before selection and keep planar, scale and ownership guards", () => {
  const options = { layerCount: 8, allowBlindAndBuriedVias: false, traceClearance: 0.1,
    viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1 }
  const context: SingleTransitionBoardContext = { obstacles: [], layerCount: 8,
    allowBlindAndBuriedVias: false, coordinateScale: 1, viaToPadClearance: 0.1,
    traceToPadClearance: 0.1, traceToHoleClearance: 0.2, viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    boardGeometry: { bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 } } }
  const start: PortPoint = { x: -1, y: 0.5, z: 4, connectionName: "moving" }
  const end: PortPoint = { x: 1, y: 0.5, z: 5, connectionName: "moving" }
  const input = { nominal: { x: 0, y: 0 }, start, end, connectionName: "moving",
    center: { x: 0, y: 0 }, viaDiameter: 0.3, traceThickness: 0.1, context }
  const routeAt = (p: { x: number; y: number }, a = start, b = end): HighDensityIntraNodeRoute => ({
    connectionName: a.connectionName, rootConnectionName: a.rootConnectionName,
    traceThickness: 0.1, viaDiameter: 0.3, vias: [p],
    route: [a, { ...p, z: a.z }, { ...p, z: b.z }, b],
  })
  const wire: HighDensityIntraNodeRoute = { connectionName: "prior", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -4, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }], vias: [] }
  const index = new CompletedCopperWorldIndex(options)
  index.addRoutes([wire])
  const before = JSON.stringify(index.query({ minX: -5, maxX: 5, minY: -5, maxY: 5 }))
  expect(findSingleTransitionVia(input)).toBe(input.nominal)
  expect(areRoutesClearOfCompletedCopper({ routes: [routeAt(input.nominal)], routedPeerWorldIndex: index })).toBe(false)
  const selected = findSingleTransitionVia({ ...input, context: { ...context, routedPeerWorldIndex: index } })
  expect(selected).toBeDefined()
  expect(selected).not.toEqual(input.nominal)
  // Prior endpoints are four millimetres away; its interior still blocks the full through barrel.
  expect(Math.abs(selected!.y)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  expect(areRoutesClearOfCompletedCopper({ routes: [routeAt(selected!)], routedPeerWorldIndex: index })).toBe(true)
  expect(JSON.stringify(index.query({ minX: -5, maxX: 5, minY: -5, maxY: 5 }))).toBe(before)

  const priorVia: HighDensityIntraNodeRoute = { ...wire,
    route: [{ x: 0.35, y: 0, z: 0 }, { x: 0.35, y: 0, z: 1 }], vias: [{ x: 0.35, y: 0 }] }
  const vias = new CompletedCopperWorldIndex(options)
  vias.addRoutes([priorVia])
  const away = findSingleTransitionVia({ ...input, context: { ...context, routedPeerWorldIndex: vias } })
  expect(away).toBeDefined()
  expect(Math.hypot(away!.x - 0.35, away!.y)).toBeGreaterThanOrEqual(0.4 - 1e-9)
  expect(areRoutesClearOfCompletedCopper({ routes: [routeAt(away!)], routedPeerWorldIndex: vias })).toBe(true)

  const planar: HighDensityIntraNodeRoute = { ...wire, connectionName: "moving",
    route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }] }
  expect(areSingleTransitionPlanarRoutesClear({ routes: [planar], context, center: input.center })).toBe(true)
  expect(areSingleTransitionPlanarRoutesClear({ routes: [planar],
    context: { ...context, routedPeerWorldIndex: index }, center: input.center })).toBe(false)

  const connMap = new ConnectivityMap({ "0": ["moving", "ownAlias"], "1": ["0", "foreign"] })
  const own = new CompletedCopperWorldIndex(options)
  own.addRoutes([{ ...wire, connectionName: "ownAlias", rootConnectionName: "0" }])
  const canonicalStart = { ...start, rootConnectionName: "0" }
  const canonicalEnd = { ...end, rootConnectionName: "0" }
  expect(findSingleTransitionVia({ ...input, start: canonicalStart, end: canonicalEnd,
    context: { ...context, connMap, routedPeerWorldIndex: own } })).toBe(input.nominal)
  const foreign = new CompletedCopperWorldIndex(options)
  foreign.addRoutes([{ ...wire, connectionName: "ownAlias", rootConnectionName: "1" }])
  const protectedVia = findSingleTransitionVia({ ...input, start: canonicalStart, end: canonicalEnd,
    context: { ...context, connMap, routedPeerWorldIndex: foreign } })
  expect(protectedVia).toBeDefined()
  expect(areRoutesClearOfCompletedCopper({ routes: [routeAt(protectedVia!, canonicalStart, canonicalEnd)],
    routedPeerWorldIndex: foreign, connMap })).toBe(true)

  const center = { x: 10, y: 20 }
  const worldWire = { ...wire, route: wire.route.map((p) => ({ ...p, x: center.x + p.x, y: center.y + p.y })) }
  const worldIndex = new CompletedCopperWorldIndex(options)
  worldIndex.addRoutes([worldWire])
  for (const scale of [0.5, 2]) {
    const transform = <T extends { x: number; y: number }>(p: T): T => ({ ...p,
      x: center.x + p.x * scale, y: center.y + p.y * scale })
    const scaledStart = transform(start), scaledEnd = transform(end)
    const scaledContext: SingleTransitionBoardContext = { ...context, coordinateScale: scale,
      routedPeerWorldIndex: worldIndex,
      boardGeometry: { bounds: { minX: 5, maxX: 15, minY: 15, maxY: 25 } } }
    const scaled = findSingleTransitionVia({ ...input, center, nominal: center,
      start: scaledStart, end: scaledEnd, context: scaledContext })
    expect(scaled).toBeDefined()
    expect(center.x + (scaled!.x - center.x) / scale).toBeCloseTo(center.x + selected!.x, 9)
    expect(center.y + (scaled!.y - center.y) / scale).toBeCloseTo(center.y + selected!.y, 9)
    expect(areRoutesClearOfCompletedCopper({ routes: [routeAt(scaled!, scaledStart, scaledEnd)],
      routedPeerWorldIndex: worldIndex, center, coordinateScale: scale })).toBe(true)
    const scaledPlanar = { ...planar, route: planar.route.map(transform) }
    expect(areSingleTransitionPlanarRoutesClear({ routes: [scaledPlanar], context: scaledContext, center })).toBe(false)
  }
})
