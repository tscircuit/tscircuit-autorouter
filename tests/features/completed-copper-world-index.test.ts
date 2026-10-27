import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  CompletedCopperWorldIndex,
  areCopperRoutesOnSameNet,
  areRoutesClearOfCompletedCopper,
  queryCompletedCopperWorldIndex,
} from "../../lib/solvers/HighDensitySolver/completedCopperWorldIndex"
import type { HighDensityIntraNodeRoute } from "../../lib/types/high-density-types"

type Point = { x: number; y: number; z: number; traceThickness?: number }

const wire = (name: string, a: Point, b: Point, rootConnectionName?: string): HighDensityIntraNodeRoute => ({
  connectionName: name, rootConnectionName, traceThickness: 0.1, viaDiameter: 0.3,
  route: [a, b], vias: [],
})
const via = (name: string, x: number, y: number, rootConnectionName?: string): HighDensityIntraNodeRoute => ({
  ...wire(name, { x, y, z: 4 }, { x, y, z: 5 }, rootConnectionName), vias: [{ x, y }],
})
const options = { layerCount: 8, allowBlindAndBuriedVias: false, traceClearance: 0.1,
  viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1 }

test("completed WORLD copper rejects foreign interior crossings and full barrels while preserving ownership, scale and physical spacing", () => {
  const long = wire("old", { x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })
  const saved = JSON.stringify(long)
  const index = new CompletedCopperWorldIndex(options)
  index.addRoutes([long])
  const check = (routes: HighDensityIntraNodeRoute[], target = index, extra: {
    connMap?: ConnectivityMap; center?: { x: number; y: number }; coordinateScale?: number
  } = {}): boolean => areRoutesClearOfCompletedCopper({ routes, routedPeerWorldIndex: target, ...extra })
  const crossing = wire("new", { x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 })
  // Both candidate endpoints clear the old endpoints; their interiors intersect across cells.
  expect(check([crossing])).toBe(false)
  expect(check([wire("new", { x: -1, y: 0.2, z: 0 }, { x: 1, y: 0.2, z: 0 })])).toBe(true)
  expect(check([wire("new", { x: -1, y: 0.199, z: 0 }, { x: 1, y: 0.199, z: 0 })])).toBe(false)
  expect(check([wire("new", { x: 0, y: -1, z: 1 }, { x: 0, y: 1, z: 1 })])).toBe(true)
  expect(queryCompletedCopperWorldIndex(index, { minX: -0.01, maxX: 0.01, minY: -0.01, maxY: 0.01 }).length).toBeGreaterThan(0)
  expect(JSON.stringify(long)).toBe(saved)

  const annulus = new CompletedCopperWorldIndex(options)
  annulus.addRoutes([via("old", 0, 0)])
  expect(check([crossing], annulus)).toBe(false) // Logical4->5 barrel also occupies TOP.
  expect(check([wire("new", { x: -1, y: 0.3, z: 0 }, { x: 1, y: 0.3, z: 0 })], annulus)).toBe(true)
  expect(check([wire("new", { x: -1, y: 0.299, z: 0 }, { x: 1, y: 0.299, z: 0 })], annulus)).toBe(false)
  const blind = new CompletedCopperWorldIndex({ ...options, allowBlindAndBuriedVias: true })
  blind.addRoutes([via("old", 0, 0)])
  expect(check([crossing], blind)).toBe(true)

  const zero = new CompletedCopperWorldIndex({ ...options, traceClearance: 0 })
  zero.addRoutes([long, via("oldVia", 5, 0)])
  expect(check([wire("new", { x: -1, y: 0.1, z: 0 }, { x: 1, y: 0.1, z: 0 })], zero)).toBe(true)
  expect(check([wire("new", { x: -1, y: 0.099, z: 0 }, { x: 1, y: 0.099, z: 0 })], zero)).toBe(false)
  // Independent .1 via-annulus edge floor survives explicit zero trace clearance.
  expect(check([via("newVia", 5.399, 0)], zero)).toBe(false)
  expect(check([via("newVia", 5.4, 0)], zero)).toBe(true)
  const drill = new CompletedCopperWorldIndex({ ...options, minViaHoleEdgeToViaHoleEdgeClearance: 0.6 })
  drill.addRoutes([via("old", 0, 0)])
  expect(check([via("new", 0.749, 0)], drill)).toBe(false)
  expect(check([via("new", 0.75, 0)], drill)).toBe(true)
  const larger = new CompletedCopperWorldIndex({ ...options, traceClearance: 0.3 })
  larger.addRoutes([long])
  expect(check([wire("new", { x: -1, y: 0.399, z: 0 }, { x: 1, y: 0.399, z: 0 })], larger)).toBe(false)
  expect(check([wire("new", { x: -1, y: 0.4, z: 0 }, { x: 1, y: 0.4, z: 0 })], larger)).toBe(true)

  const connMap = new ConnectivityMap({ "0": ["oldAlias", "newAlias"], "1": ["0", "foreignAlias"] })
  // Numeric runtime labels follow ordinary alias lookup, as Set(Object.keys(...)).has(0) was false.
  const numericLabel = { connectionName: 0 as unknown as string }
  expect(areCopperRoutesOnSameNet(numericLabel, { connectionName: "foreignAlias", rootConnectionName: "1" }, connMap)).toBe(true)
  expect(areCopperRoutesOnSameNet(numericLabel, { connectionName: "oldAlias", rootConnectionName: "0" }, connMap)).toBe(false)
  const legacyConnMap = { getNetConnectedToId: (id: string) =>
    id === "legacyA" || id === "legacyB" ? "legacyNet" : undefined } as unknown as ConnectivityMap
  expect(areCopperRoutesOnSameNet({ connectionName: "legacyA" }, { connectionName: "legacyB" }, legacyConnMap)).toBe(true)
  expect(areCopperRoutesOnSameNet({ connectionName: "legacyA" }, { connectionName: "unknown" }, legacyConnMap)).toBe(false)
  const owned = new CompletedCopperWorldIndex(options)
  owned.addRoutes([wire("oldAlias", long.route[0]!, long.route[1]!, "0")])
  expect(check([{ ...crossing, connectionName: "newAlias", rootConnectionName: "0" }], owned, { connMap })).toBe(true)
  // Canonical root1 remains foreign even if its literal alias belongs to canonical0.
  expect(check([{ ...crossing, connectionName: "newAlias", rootConnectionName: "1" }], owned, { connMap })).toBe(false)
  // Net0's canonical key must never be resolved again as the literal alias in net1.
  expect(check([{ ...crossing, connectionName: "0", rootConnectionName: "0" }], owned, { connMap })).toBe(true)
  owned.addRoutes([wire("newAlias", long.route[0]!, long.route[1]!, "0")])
  expect(check([{ ...crossing, connectionName: "oldAlias", rootConnectionName: "0" }], owned, { connMap })).toBe(true)

  const sameVia = new CompletedCopperWorldIndex(options)
  sameVia.addRoutes([via("oldAlias", 0, 0, "0")])
  expect(check([via("newAlias", 0, 0, "0")], sameVia, { connMap })).toBe(true)
  expect(check([via("newAlias", 0.2, 0, "0")], sameVia, { connMap })).toBe(false)

  const empty = new CompletedCopperWorldIndex(options)
  expect(check([long, crossing], empty)).toBe(false)
  expect(check([long, { ...crossing, connectionName: "old" }], empty)).toBe(true)
  const wide = new CompletedCopperWorldIndex(options)
  wide.addRoutes([wire("old", { x: -2, y: 0, z: 0, traceThickness: 0.4 }, { x: 2, y: 0, z: 0 })])
  expect(check([wire("new", { x: -1, y: 0.349, z: 0 }, { x: 1, y: 0.349, z: 0 })], wide)).toBe(false)
  expect(check([wire("new", { x: -1, y: 0.35, z: 0 }, { x: 1, y: 0.35, z: 0 })], wide)).toBe(true)

  // A diagonal XY/Z segment materializes its via at the endpoint and its wire on the source plane.
  const mixed = new CompletedCopperWorldIndex(options)
  mixed.addRoutes([{ ...wire("old", { x: -1, y: 0, z: 4 }, { x: 1, y: 0, z: 5 }), vias: [{ x: 1, y: 0 }] }])
  expect(check([wire("new", { x: 0.9, y: -1, z: 0 }, { x: 0.9, y: 1, z: 0 })], mixed)).toBe(false)
  expect(check([wire("new", { x: 0, y: -1, z: 4 }, { x: 0, y: 1, z: 4 })], mixed)).toBe(false)
  expect(check([wire("new", { x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 })], mixed)).toBe(true)

  const center = { x: 10, y: 20 }
  for (const coordinateScale of [0.5, 2]) {
    const scaled = (route: HighDensityIntraNodeRoute): HighDensityIntraNodeRoute => ({ ...route,
      route: route.route.map((p) => ({ ...p, x: center.x + (p.x - center.x) * coordinateScale,
        y: center.y + (p.y - center.y) * coordinateScale })),
      vias: route.vias.map((p) => ({ x: center.x + (p.x - center.x) * coordinateScale,
        y: center.y + (p.y - center.y) * coordinateScale })),
    })
    expect(check([scaled(crossing)], index, { center, coordinateScale })).toBe(false)
    expect(check([scaled(wire("new", { x: -1, y: 0.2, z: 0 }, { x: 1, y: 0.2, z: 0 }))], index, { center, coordinateScale })).toBe(true)
    expect(check([scaled(via("new", 0, 0))], annulus, { center, coordinateScale })).toBe(false)
  }
})
