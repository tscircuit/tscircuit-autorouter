import { importReference } from "./tsReference"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { findPadClearanceViaPosition } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findPadClearanceViaPosition"
const { findPadClearanceViaPosition: findPadClearanceViaPositionTs } = await importReference<typeof import("high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findPadClearanceViaPosition")>("node_modules/high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findPadClearanceViaPosition.ts")
import { findTraceClearanceViaPositions } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findTraceClearanceViaPositions"
const { findTraceClearanceViaPositions: findTraceClearanceViaPositionsTs } = await importReference<typeof import("high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findTraceClearanceViaPositions")>("node_modules/high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findTraceClearanceViaPositions.ts")
import type { Point, Segment, ViaNode } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/internalTypes"
import type { HighDensityRoute, SimpleRouteJson } from "high-density-repair03/lib"
import { loadTargetedRepairBindings } from "../../../lib/bindings/repair/TargetedRepairAdapter"

type PadFixture = { name: string; srj: SimpleRouteJson; preferred: Point; radius: number; layers: number[] }
type TraceFixture = { name: string; via: ViaNode; segments: Segment[]; clearance: number }

function board(obstacles: SimpleRouteJson["obstacles"] = []): SimpleRouteJson {
  return { layerCount: 4, minTraceWidth: 0.1, minViaDiameter: 0.3,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles, connections: [],
    minViaEdgeToPadEdgeClearance: 0.1 }
}

function pad(x: number, y: number, angle?: number): SimpleRouteJson["obstacles"][number] {
  return { type: "rect", center: { x, y }, width: 0.4, height: 0.25,
    layers: ["top"], connectedTo: ["foreign"], ...(angle === undefined ? {} : { ccwRotationDegrees: angle }) }
}

function segment(start: Point, end: Point, z = 0, rootConnectionName = "foreign"): Segment {
  return { routeIndex: 1, rootConnectionName, startIndex: 0, endIndex: 1,
    start, end, z, radius: 0.05 }
}

function checkBytes(actual: unknown, expected: unknown, name: string): void {
  const actualBytes = JSON.stringify(actual)
  const expectedBytes = JSON.stringify(expected)
  assert.equal(actualBytes, expectedBytes, name)
}

const route: HighDensityRoute = { connectionName: "signal", rootConnectionName: "root",
  traceThickness: 0.1, viaDiameter: 0.3, route: [], vias: [] }
const baseVia: ViaNode = { routeIndex: 0, rootConnectionName: "root", pointIndexes: [1, 2], zLayers: [0, 2],
  x: 0, y: 0, radius: 0.15, movable: true, canCanonicalize: true }
const padFixtures: PadFixture[] = [
  { name: "preferred-identity", srj: board(), preferred: { x: 0.5, y: -0.5 }, radius: 0.15, layers: [0, 3] },
  { name: "project-board-edge", srj: board(), preferred: { x: 2, y: 0.4 }, radius: 0.15, layers: [0, 3] },
  { name: "impossible-board", srj: board(), preferred: { x: 0, y: 0 }, radius: 3, layers: [0, 3] },
  { name: "centered-pad-tie", srj: board([pad(0, 0)]), preferred: { x: 0, y: 0 }, radius: 0.15, layers: [0, 3] },
  { name: "overlapping-component", srj: board([pad(0, 0), pad(0.4, 0.1), pad(-0.3, -0.1), pad(1.5, 1.5)]), preferred: { x: 0.1, y: 0.1 }, radius: 0.15, layers: [0, 3] },
  { name: "board-corner-intersection", srj: board([pad(1.6, 1.6, 45)]), preferred: { x: 1.8, y: 1.8 }, radius: 0.2, layers: [0, 3] },
  { name: "no-feasible-placement", srj: board([{ ...pad(0, 0), width: 5, height: 5 }]), preferred: { x: 0, y: 0 }, radius: 0.15, layers: [0, 3] },
  { name: "layer-filter", srj: board([{ ...pad(0, 0), layers: ["bottom"] }]), preferred: { x: 0, y: 0 }, radius: 0.15, layers: [0, 2] },
  { name: "pour-filter", srj: board([{ ...pad(0, 0), isCopperPour: true }]), preferred: { x: 0, y: 0 }, radius: 0.15, layers: [0, 3] },
  { name: "circular-via-pad", srj: board([{ ...pad(0, 0), width: 0.4, height: 0.4, layers: ["top", "inner1", "inner2", "bottom"] }]), preferred: { x: 0, y: 0 }, radius: 0.15, layers: [2, 0] },
]
for (const angle of [0, 30, 45, 90, -17.3, 123.456]) {
  padFixtures.push({ name: `rotated-${angle}`, srj: board([pad(0.13, -0.07, angle)]), preferred: { x: 0.15, y: -0.04 }, radius: 0.15, layers: [0, 3] })
}
const traceFixtures: TraceFixture[] = [
  { name: "via-identity", via: baseVia, segments: [], clearance: 0.1 },
  { name: "parallel-capsule", via: baseVia, segments: [segment({ x: -1, y: 0.22 }, { x: 1, y: 0.22 })], clearance: 0.1 },
  { name: "capsule-end", via: baseVia, segments: [segment({ x: 0.22, y: 0 }, { x: 1, y: 0 })], clearance: 0.1 },
  { name: "capsule-intersections", via: baseVia, segments: [segment({ x: -1, y: 0.22 }, { x: 1, y: 0.22 }), segment({ x: 0.22, y: -1 }, { x: 0.22, y: 1 })], clearance: 0.1 },
  { name: "circle-circle-intersections", via: baseVia, segments: [segment({ x: 0.25, y: 0.15 }, { x: 1, y: 0.15 }), segment({ x: -0.25, y: 0.15 }, { x: -1, y: 0.15 })], clearance: 0.1 },
  { name: "no-feasible-local-point", via: baseVia, segments: [segment({ x: -1, y: 0 }, { x: 1, y: 0 })], clearance: 0.1 },
  { name: "degenerate-segment", via: baseVia, segments: [segment({ x: 0.22, y: 0 }, { x: 0.22, y: 0 })], clearance: 0.1 },
  { name: "layer-filter", via: baseVia, segments: [segment({ x: -1, y: 0 }, { x: 1, y: 0 }, 3)], clearance: 0.1 },
  { name: "same-net-filter", via: baseVia, segments: [segment({ x: -1, y: 0 }, { x: 1, y: 0 }, 0, "root")], clearance: 0.1 },
]

await loadTargetedRepairBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
const connMap = new ConnectivityMap({})
for (const connectivity of ["absent", "disconnected", "joined", "removed"] as const) {
  if (connectivity === "joined") connMap.addConnections([["root", "foreign"]])
  const map = connectivity === "absent" || connectivity === "removed" ? undefined : connMap
  for (const fixture of padFixtures) {
    const before = JSON.stringify({ fixture, route, map })
    const expected = findPadClearanceViaPositionTs(fixture.srj, route, fixture.preferred, fixture.radius, fixture.layers, map)
    const actual = findPadClearanceViaPosition(fixture.srj, route, fixture.preferred, fixture.radius, fixture.layers, map)
    checkBytes(actual, expected, `${fixture.name}/${connectivity}`)
    assert.equal(actual === fixture.preferred, expected === fixture.preferred, `${fixture.name} preferred identity`)
    assert.equal(JSON.stringify({ fixture, route, map }), before, `${fixture.name} input mutation`)
  }
  for (const fixture of traceFixtures) {
    const before = JSON.stringify({ fixture, map })
    const expected = findTraceClearanceViaPositionsTs(fixture.via, fixture.segments, fixture.clearance, map)
    const actual = findTraceClearanceViaPositions(fixture.via, fixture.segments, fixture.clearance, map)
    checkBytes(actual, expected, `${fixture.name}/${connectivity}`)
    assert.deepEqual(actual.map((point) => point === fixture.via), expected.map((point) => point === fixture.via), `${fixture.name} via identity`)
    assert.equal(JSON.stringify({ fixture, map }), before, `${fixture.name} input mutation`)
  }
  console.log(`${connectivity}: ${padFixtures.length} pad and ${traceFixtures.length} trace fixtures identical`)
}
