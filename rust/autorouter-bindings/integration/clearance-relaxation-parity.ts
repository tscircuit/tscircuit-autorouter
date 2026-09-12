import { importReference } from "./tsReference"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute, SimpleRouteJson } from "high-density-repair03/lib"
const { applyTraceToPadClearanceRelaxation } = await importReference<typeof import("high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/traceToPadClearanceRelaxation")>("node_modules/high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/traceToPadClearanceRelaxation.ts")
const { applyViaToPadClearanceRelaxation } = await importReference<typeof import("high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation")>("node_modules/high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation.ts")
import * as bindings from "../pkg/autorouter_bindings.js"
import { loadAutorouterBindings } from "../ts/index"

type Fixture = { name: string; srj: SimpleRouteJson; routes: HighDensityRoute[] }
type Result = { changed: boolean; routes: HighDensityRoute[] }

function board(obstacles: SimpleRouteJson["obstacles"] = []): SimpleRouteJson {
  return { layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 3 }, obstacles, connections: [],
    minTraceToPadEdgeClearance: 0.1, minViaEdgeToPadEdgeClearance: 0.1 }
}

function route(name: string, points: HighDensityRoute["route"], vias: HighDensityRoute["vias"] = []): HighDensityRoute {
  return { connectionName: name, rootConnectionName: name, traceThickness: 0.1,
    viaDiameter: 0.3, route: points, vias, jumpers: [] }
}

function runFixture(fixture: Fixture, connMap?: ConnectivityMap): void {
  const { srj, routes, name } = fixture
  const before = JSON.stringify({ srj, routes, connMap })
  for (const kind of ["trace", "via"] as const) {
    const expected = kind === "trace" ? applyTraceToPadClearanceRelaxation(srj, routes, connMap)
      : applyViaToPadClearanceRelaxation(srj, routes, connMap)
    const actual = JSON.parse(bindings.GlobalDrcBranchPortfolioSolver.relax(JSON.stringify(srj), JSON.stringify(routes),
      JSON.stringify(connMap ? { netMap: connMap.netMap, idToNetMap: connMap.idToNetMap } : null), kind)) as Result
    const expectedBytes = JSON.stringify(expected)
    const actualBytes = JSON.stringify(actual.routes)
    let first = 0
    while (first < Math.min(actualBytes.length, expectedBytes.length) && actualBytes[first] === expectedBytes[first]) first++
    assert.ok(expectedBytes === actualBytes, `${name}/${kind}: differing byte ${first}\nTS ${expectedBytes.slice(Math.max(0, first - 40), first + 140)}\nWASM ${actualBytes.slice(Math.max(0, first - 40), first + 140)}`)
    assert.equal(actual.changed, expected !== routes, `${name}/${kind} unchanged identity flag`)
    assert.equal(JSON.stringify({ srj, routes, connMap }), before, `${name}/${kind} input mutation`)
    console.log(`${name}/${kind}: exact route bytes and changed flag identical`)
  }
}

await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
const pad: SimpleRouteJson["obstacles"][number] = { type: "rect", center: { x: 0, y: -0.5 },
  width: 0.8, height: 1, layers: ["top"], connectedTo: ["foreign"] }
// Minimum-width geometry follows repair03's broad-repulsion-minimum-width-
// stability fixture; these assertions exercise the independent relaxation paths.
const trace = route("signal", [
  { x: -2, y: 0.5, z: 0, pcb_port_id: "start" },
  { x: -0.5, y: 0.15, z: 0, insideJumperPad: false },
  { x: 0.5, y: 0.15, z: 0 }, { x: 2, y: 0.5, z: 0, pcb_port_id: "end" },
])
const via = route("signal", [{ x: -1, y: 0.1, z: 0, pcb_port_id: "start" },
  { x: 0, y: 0.1, z: 0 }, { x: 0, y: 0.1, z: 1 },
  { x: 1, y: 0.1, z: 1, pcb_port_id: "end" }], [{ x: 0, y: 0.1 }])
const fixtures: Fixture[] = [
  { name: "empty", srj: board(), routes: [] },
  { name: "no-blockers", srj: board(), routes: [trace] },
  { name: "disabled", srj: { ...board([pad]), minTraceToPadEdgeClearance: 0, minViaEdgeToPadEdgeClearance: 0 }, routes: [trace, via] },
  { name: "unspecified", srj: { ...board([pad]), minTraceToPadEdgeClearance: undefined, minViaEdgeToPadEdgeClearance: undefined }, routes: [trace, via] },
  { name: "trace-pad", srj: board([pad]), routes: [trace] },
  { name: "via-pad", srj: board([pad]), routes: [via] },
  { name: "ordered-neighbors", srj: board([pad]), routes: [trace, { ...structuredClone(via), connectionName: "neighbor", rootConnectionName: "neighbor" }] },
  { name: "inside-jumper-fixed", srj: board([pad]), routes: [{ ...trace, route: trace.route.map((point) => ({ ...point, insideJumperPad: true })) }] },
  { name: "same-net-attached", srj: board([{ ...pad, connectedTo: ["signal"] }]), routes: [{ ...via, route: via.route.map((point) => ({ ...point, y: -0.1 })), vias: [{ x: 0, y: -0.1 }] }] },
  { name: "other-layer", srj: board([{ ...pad, layers: ["bottom"] }]), routes: [trace] },
  { name: "explicit-z-layers", srj: board([{ ...pad, layers: ["bottom"], zLayers: [0] }]), routes: [trace] },
  { name: "pour", srj: board([{ ...pad, isCopperPour: true }]), routes: [trace, via] },
  { name: "narrow-bounds", srj: { ...board([pad]), bounds: { minX: -2, maxX: 2, minY: -0.1, maxY: 0.15 } }, routes: [via] },
]
const nullClearance = board([pad])
Object.assign(nullClearance, { minTraceToPadEdgeClearance: null, minViaEdgeToPadEdgeClearance: null })
fixtures.push({ name: "null-clearance", srj: nullClearance, routes: [trace, via] })
for (const fixture of fixtures) runFixture(fixture)
const connMap = new ConnectivityMap({})
runFixture({ name: "connectivity-before", srj: board([pad]), routes: [trace, via] }, connMap)
connMap.addConnections([["signal", "foreign"]])
runFixture({ name: "connectivity-after", srj: board([pad]), routes: [trace, via] }, connMap)

// Reuse captured native repair invocation files when available.
const argument = process.argv.indexOf("--input-dir")
if (argument !== -1) {
  const directory = process.argv[argument + 1]
  assert.ok(directory, "--input-dir requires a directory")
  const files = readdirSync(directory).filter((file) => /^input-\d+\.json$/.test(file)).sort()
  assert.ok(files.length > 0, "No captured input files")
  for (const file of files) {
    const input = JSON.parse(readFileSync(join(directory, file), "utf8")) as {
      srj: SimpleRouteJson; routes: HighDensityRoute[]; connMap: object | null
    }
    runFixture({ name: file, srj: input.srj, routes: input.routes }, input.connMap === null ? undefined : Object.assign(new ConnectivityMap({}), input.connMap))
  }
}
