import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("columns independently reject wrong terminals, fixed copper, full-span via copper and same-owner drill overlap", (): void => {
  const a = columnRoute("a", [{ x: -4, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 4, y: 0, z: 1 }], [{ x: 0, y: 0 }])
  const b = columnRoute("b", [{ x: 0, y: -4, z: 3 }, { x: 0, y: 4, z: 3 }])
  const through = columnPool([a, b])
  through.offerRoute(a, "native")
  through.offerRoute(b, "a01")
  expect(through.params.diagnostics.routeColumnAcceptedColumns).toBe(2)
  expect(through.solvedRoutes).toBeUndefined()
  const blind = columnPool([a, b], { allowBlindAndBuriedVias: true })
  blind.offerRoute(a, "native")
  blind.offerRoute(b, "a01")
  expect(blind.solvedRoutes).toHaveLength(2)

  const shifted = { ...b, route: b.route.map((p) => ({ ...p, x: 0.2 })) }
  const identity = columnPool([a, b])
  identity.offerRoute(shifted, "native")
  expect(identity.params.diagnostics.routeColumnRejectedStatic).toBe(1)
  identity.offerRoute({ ...b, startPcbPortId: "another-pad" }, "native")
  expect(identity.params.diagnostics.routeColumnRejectedStatic).toBe(2)
  const fixed = columnPool([a, b], { obstacles: [{
    type: "rect", obstacleId: "fixed", center: { x: 0, y: -2 }, width: 1, height: 1,
    layers: ["bottom"], __zLayers: [3], connectedTo: [],
  }] })
  fixed.offerRoute(b, "native")
  expect(fixed.params.diagnostics.routeColumnRejectedStatic).toBe(1)
  const board = columnPool([a, b], { boardGeometry: {
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 }, minBoardEdgeClearance: 0.1,
    outline: [{ x: -6, y: -6 }, { x: 6, y: -6 }, { x: 6, y: -3 }, { x: -3, y: 6 }, { x: -6, y: 6 }],
  } })
  board.offerRoute(b, "native")
  expect(board.params.diagnostics.routeColumnRejectedStatic).toBe(1)
  const innerPad = [{ type: "rect" as const, obstacleId: "under-via", center: { x: 0, y: 0 },
    width: 0.4, height: 0.4, layers: ["bottom"], __zLayers: [3], connectedTo: [] }]
  const fixedThrough = columnPool([a, b], { obstacles: innerPad })
  fixedThrough.offerRoute(a, "native")
  expect(fixedThrough.params.diagnostics.routeColumnRejectedStatic).toBe(1)
  const fixedBlind = columnPool([a, b], { obstacles: innerPad, allowBlindAndBuriedVias: true })
  fixedBlind.offerRoute(a, "native")
  expect(fixedBlind.params.diagnostics.routeColumnAcceptedColumns).toBe(1)
  const pad = [{ type: "rect" as const, obstacleId: "near-via", center: { x: 0.6, y: 0 },
    width: 0.2, height: 0.2, layers: ["top"], __zLayers: [0], connectedTo: [] }]
  const ordinaryGap = columnPool([a, b], { obstacles: pad })
  ordinaryGap.offerRoute(a, "native")
  expect(ordinaryGap.params.diagnostics.routeColumnAcceptedColumns).toBe(1)
  const requiredPadGap = columnPool([a, b], { obstacles: pad, viaToPadClearance: 0.4 })
  requiredPadGap.offerRoute(a, "native")
  expect(requiredPadGap.params.diagnostics.routeColumnRejectedStatic).toBe(1)

  const c = columnRoute("c", [{ x: -4, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }, { x: 0.2, y: 0, z: 1 }, { x: 4, y: 0, z: 1 }], [{ x: 0.2, y: 0 }])
  const owner = new ConnectivityMap({ owner: ["a", "c"] })
  const drills = columnPool([a, c], { connMap: owner })
  drills.offerRoute(a, "native")
  drills.offerRoute(c, "a01")
  expect(drills.params.diagnostics.routeColumnAcceptedColumns).toBe(2)
  expect(drills.solvedRoutes).toBeUndefined()
  expect(drills.params.diagnostics.routeColumnFinitePoolUnknown).toBe(1)
})
