import { importReference } from "./tsReference"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyDrcErrorForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
const { applyDrcErrorForces: applyDrcErrorForcesTs } = await importReference<typeof import("high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers")>("node_modules/high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers.ts")
import { findPadClearanceViaPosition } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findPadClearanceViaPosition"
const { findPadClearanceViaPosition: findPadClearanceViaPositionTs } = await importReference<typeof import("high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findPadClearanceViaPosition")>("node_modules/high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findPadClearanceViaPosition.ts")
import { findTraceClearanceViaPositions } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findTraceClearanceViaPositions"
const { findTraceClearanceViaPositions: findTraceClearanceViaPositionsTs } = await importReference<typeof import("high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findTraceClearanceViaPositions")>("node_modules/high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/findTraceClearanceViaPositions.ts")
import { loadTargetedRepairBindings } from "../../../lib/bindings/repair/TargetedRepairAdapter"
import type { HighDensityRoute, SimpleRouteJson } from "high-density-repair03/lib"

type ForceArgs = Parameters<typeof applyDrcErrorForces>
type PadArgs = Parameters<typeof findPadClearanceViaPosition>
type TraceArgs = Parameters<typeof findTraceClearanceViaPositions>
type ConnectivityInput = { netMap: ConnectivityMap["netMap"]; idToNetMap: ConnectivityMap["idToNetMap"] } | null

function connectivity(input: ConnectivityInput): ConnectivityMap | undefined {
  if (input === null) return undefined
  const result = new ConnectivityMap({})
  result.netMap = input.netMap
  result.idToNetMap = input.idToNetMap
  return result
}

function checkForce(input: unknown[], label: string, live?: { srj: SimpleRouteJson; connMap: ConnectivityMap }): void {
  const makeArgs = (): ForceArgs => {
    const args = structuredClone(input) as unknown[]
    args[3] = new Map(Object.entries(args[3] as Record<string, number>))
    args[5] = connectivity(args[5] as ConnectivityInput)
    if (live) {
      args[0] = live.srj
      args[5] = live.connMap
    }
    return args as ForceArgs
  }
  const expected = makeArgs()
  const actual = makeArgs()
  const expectedRefs = expected[1].map((route) => [...route.route])
  const actualRefs = actual[1].map((route) => [...route.route])
  const arrays = actual[1].map((route) => route.route)
  const vias = actual[1].map((route) => route.vias)
  const originalInput = JSON.stringify([actual[0], actual[2], [...actual[3]]])
  const expectedChanged = applyDrcErrorForcesTs(...expected)
  const actualChanged = applyDrcErrorForces(...actual)
  assert.equal(actualChanged, expectedChanged, `${label}: changed`)
  assert.equal(JSON.stringify(actual[1]), JSON.stringify(expected[1]), `${label}: exact route bytes`)
  assert.equal(JSON.stringify([actual[0], actual[2], [...actual[3]]]), originalInput, `${label}: read-only inputs`)
  for (let r = 0; r < actual[1].length; r++) {
    assert.equal(actual[1][r].route, arrays[r], `${label}: route array identity`)
    assert.equal(actual[1][r].vias, vias[r], `${label}: vias identity`)
    for (let p = 0; p < expected[1][r].route.length; p++) {
      assert.equal(actualRefs[r].indexOf(actual[1][r].route[p]), expectedRefs[r].indexOf(expected[1][r].route[p]), `${label}: point identity ${r}/${p}`)
    }
  }
}

function checkPad(input: unknown[], label: string): void {
  const args = structuredClone(input) as PadArgs
  args[5] = connectivity(input[5] as ConnectivityInput)
  const before = JSON.stringify(args)
  const expected = findPadClearanceViaPositionTs(...args)
  const actual = findPadClearanceViaPosition(...args)
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), `${label}: point bytes`)
  assert.equal(actual === args[2], expected === args[2], `${label}: preferred identity`)
  assert.equal(JSON.stringify(args), before, `${label}: input unchanged`)
}

function checkTrace(input: unknown[], label: string): void {
  const args = structuredClone(input) as TraceArgs
  args[3] = connectivity(input[3] as ConnectivityInput)
  const before = JSON.stringify(args)
  const expected = findTraceClearanceViaPositionsTs(...args)
  const actual = findTraceClearanceViaPositions(...args)
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), `${label}: candidates bytes`)
  assert.equal(actual.indexOf(args[0]), expected.indexOf(args[0]), `${label}: via identity`)
  assert.equal(JSON.stringify(args), before, `${label}: input unchanged`)
}

await loadTargetedRepairBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
const srj: SimpleRouteJson = { bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, layerCount: 2, minTraceWidth: 0.1, obstacles: [], connections: [] }
const route: HighDensityRoute = { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3, vias: [], route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] }
checkForce([srj, [route], [], {}, 1, null, true, false, true, false], "no errors")
const viaRoutes: HighDensityRoute[] = [0, 0.12].map((x, index) => ({
  connectionName: index === 0 ? "a" : "b",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  vias: [{ x, y: 0 }],
  route: [
    { x: -1, y: index * 0.4, z: 0 },
    { x, y: 0, z: 0 },
    { x, y: 0, z: 1 },
    { x: 1, y: index * 0.4, z: 1 },
  ],
}))
const viaPairError = {
  type: "pcb_via_clearance_error",
  center: { x: 0.06, y: 0 },
  pcb_via_ids: ["via_a", "via_b"],
  pcb_via_pair_net_relation: "different_net",
}
for (const scale of [1, -1, 1.75]) {
  checkForce([srj, viaRoutes, [viaPairError], { trace_a: 0, trace_b: 1 }, scale, null, true, false, true, false], `via pair scale ${scale}`)
}
const sameNetMap = new ConnectivityMap({ same: ["a", "b"] })
const sameNetError = { ...viaPairError, pcb_via_pair_net_relation: "same_net" }
checkForce([srj, viaRoutes, [sameNetError], {}, 1, sameNetMap, true, true, true, false], "same-net canonical via pair")
const ownerError = {
  type: "pcb_trace_error",
  center: { x: 0.02, y: 0 },
  pcb_trace_id: "trace_a",
  pcb_trace_ids: ["trace_a", "fixed_trace"],
  pcb_via_ids: ["via_a"],
}
checkForce([srj, viaRoutes, [ownerError], { trace_a: 0 }, 1, null, true, false, false, true], "promoted via owner")
const obstacleSrj: SimpleRouteJson = {
  ...srj,
  obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["pcb_smtpad_foreign"] }],
}
const obstacleError = {
  type: "pcb_pad_trace_clearance_error",
  center: { x: 0, y: 0 },
  pcb_trace_id: "trace_a",
  message: "pcb trace contacts pcb_smtpad_foreign",
}
const fixedSegment: HighDensityRoute = { ...route, route: [route.route[0], route.route[2]] }
for (const scale of [1, -1, 1.75]) {
  checkForce([obstacleSrj, [fixedSegment], [obstacleError], { trace_a: 0 }, scale, null, true, false, true, false], `obstacle detour scale ${scale}`)
}
const sharedSiteRoutes: HighDensityRoute[] = [
  viaRoutes[0],
  { ...viaRoutes[0], connectionName: "a_shared", rootConnectionName: "a" },
  { ...route, connectionName: "crossing", route: [{ x: -0.8, y: 0.05, z: 0 }, { x: 0, y: 0.05, z: 0 }, { x: 0.8, y: 0.05, z: 0 }] },
]
const traceViaError = {
  type: "pcb_via_trace_clearance_error",
  center: { x: 0, y: 0.05 },
  pcb_trace_id: "crossing_trace",
  pcb_via_ids: ["via_a"],
}
for (const sharedMove of [false, true]) {
  checkForce([srj, sharedSiteRoutes, [traceViaError], { crossing_trace: 2 }, 1, null, true, false, sharedMove, false], `shared via site ${sharedMove}`)
}
const liveMap = new ConnectivityMap({ left: ["a"], right: ["b"] })
const liveInput = [srj, viaRoutes, [sameNetError], {}, 1, null, true, true, true, false]
checkForce(liveInput, "live connectivity separate", { srj, connMap: liveMap })
liveMap.addConnections([["a", "b"]])
checkForce(liveInput, "live connectivity merged", { srj, connMap: liveMap })
checkPad([srj, route, { x: 0, y: 0, marker: "preserve" }, 0.15, [0, 1], null], "preferred retained")
checkPad([srj, route, { x: 0, y: 0 }, 3, [0, 1], null], "no feasible board")
const via = { routeIndex: 0, rootConnectionName: "a", pointIndexes: [1, 2], zLayers: [0, 1], x: 0, y: 0, radius: 0.15, movable: true, canCanonicalize: true }
checkTrace([via, [], 0.1, null], "via retained")
console.log("Synthetic targeted repair: identical bytes and identities")
const dirIndex = process.argv.indexOf("--input-dir")
if (dirIndex !== -1) {
  const directory = process.argv[dirIndex + 1]
  assert.ok(directory)
  const files = readdirSync(directory).filter((name) => /^(force|pad|trace)-\d+\.json$/.test(name)).sort()
  assert.ok(files.length > 0, "No captured calls")
  for (const file of files) {
    const args = JSON.parse(readFileSync(join(directory, file), "utf8")) as unknown[]
    if (file.startsWith("force-")) checkForce(args, file)
    else if (file.startsWith("pad-")) checkPad(args, file)
    else checkTrace(args, file)
    console.log(`${file}: identical bytes and identities`)
  }
}
