import { expect, test } from "bun:test"
import { PathPackingGeometry, createPathPackingAudit, type PackingGeometryParams } from "lib/solvers/HighDensitySolver/pathPackingGeometry"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { finishPackingGenerator } from "./fixtures/pathPackingSynthetic"

test("packing rejects wrong terminals, physical via spans, drill collisions, rotated pads and concave outline escapes", () => {
  const base: PackingGeometryParams = { node: { capacityMeshNodeId: "guards", center: { x: 0, y: 0 },
    width: 6, height: 6, availableZ: [0, 1, 2, 3], portPoints: [] }, obstacles: [], layerCount: 4,
    traceClearance: 0.1, viaToPadClearance: 0.1, holeClearance: 0.1,
    viaHoleDiameter: 0.15, minimumHoleGap: 0.1 }
  const wire: HighDensityRoute = { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] }
  const valid = (route: HighDensityRoute, params: PackingGeometryParams = base): boolean =>
    finishPackingGenerator(new PathPackingGeometry(params, createPathPackingAudit()).unary(route,
      { connectionName: route.connectionName, points: [route.route[0]!, route.route.at(-1)!] }))
  expect(valid(wire)).toBeTrue()
  const g = new PathPackingGeometry(base, createPathPackingAudit())
  expect(finishPackingGenerator(g.unary(wire, { connectionName: "a", points: [{ x: -1.01, y: 0, z: 0 }, wire.route.at(-1)!] }))).toBeFalse()
  expect(valid({ ...wire, traceThickness: NaN })).toBeFalse()
  expect(valid({ ...wire, vias: [{ x: 0, y: 0 }] })).toBeFalse()
  expect(valid({ ...wire, route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }] })).toBeFalse()
  const pad = { type: "rect" as const, center: { x: 0, y: 0.25 }, width: 1, height: 0.1,
    connectedTo: ["foreign"], layers: ["bottom"] }
  expect(valid(wire, { ...base, obstacles: [pad] })).toBeTrue()
  expect(valid(wire, { ...base, obstacles: [{ ...pad, layers: ["top"] }] })).toBeTrue()
  expect(valid(wire, { ...base, obstacles: [{ ...pad, layers: ["top"], ccwRotationDegrees: 45 }] })).toBeFalse()
  expect(valid(wire, { ...base, obstacles: [{ ...pad, center: { x: 0, y: 0.2 }, width: 0.2, height: 0.2,
    isNonPlatedHole: true, shape: "circle", connectedTo: ["a"] }] })).toBeFalse()
  const transition: HighDensityRoute = { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] }
  const inner = { ...pad, center: { x: 0, y: 0 }, width: 0.2, height: 0.2, layers: ["inner2"] }
  expect(valid(transition, { ...base, obstacles: [inner], allowBlindAndBuriedVias: false })).toBeFalse()
  expect(valid(transition, { ...base, obstacles: [inner], allowBlindAndBuriedVias: true })).toBeTrue()
  const closeDrills: HighDensityRoute = { connectionName: "a", traceThickness: 0.01, viaDiameter: 0.2,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0.27, y: 0, z: 1 }, { x: 0.27, y: 0, z: 0 }],
    vias: [{ x: 0, y: 0 }, { x: 0.27, y: 0 }] }
  expect(valid(closeDrills, { ...base, traceClearance: 0.01, viaHoleDiameter: 0.19 })).toBeFalse()
  const outline = [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: 0.3, y: 2 },
    { x: 0.3, y: 0 }, { x: -0.3, y: 0 }, { x: -0.3, y: 2 }, { x: -2, y: 2 }]
  expect(valid({ ...wire, route: wire.route.map((p) => ({ ...p, y: 1 })) }, { ...base,
    boardGeometry: { bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, outline } })).toBeFalse()
  expect(() => new PathPackingGeometry({ ...base, traceClearance: -1 }, createPathPackingAudit())).toThrow("physical context")
})
