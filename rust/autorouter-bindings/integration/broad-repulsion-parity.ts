import { importReference } from "./tsReference"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyBroadRepulsionForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
const { applyBroadRepulsionForces: applyBroadRepulsionForcesTs } = await importReference<typeof import("high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers")>("node_modules/high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers.ts")
import type { HighDensityRoute, SimpleRouteJson } from "high-density-repair03/lib"
import { loadBroadRepulsionBindings, BroadRepulsionAdapter } from "../../../lib/bindings/repair/BroadRepulsionAdapter"

type Fixture = { name: string; srj: SimpleRouteJson; routes: HighDensityRoute[] }
type Options = { effort: number; passes: number; sameNetVias: boolean; cleanup: boolean }
type FixtureFile = { srj: SimpleRouteJson; hdRoutes: HighDensityRoute[] }

function srj(obstacles: SimpleRouteJson["obstacles"] = []): SimpleRouteJson {
  return { layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 5 }, obstacles, connections: [],
    minTraceToPadEdgeClearance: 0.1 }
}

function route(name: string, points: HighDensityRoute["route"], width = 0.1): HighDensityRoute {
  return { connectionName: name, traceThickness: width, viaDiameter: 0.3, vias: [], route: points }
}

function checkBytes(actual: unknown, expected: unknown, label: string): void {
  const actualBytes = JSON.stringify(actual)
  const expectedBytes = JSON.stringify(expected)
  let first = 0
  while (first < Math.min(actualBytes.length, expectedBytes.length) && actualBytes[first] === expectedBytes[first]) first++
  assert.ok(actualBytes === expectedBytes,
    `${label}: first differing byte ${first}\nTS: ${expectedBytes.slice(Math.max(0, first - 60), first + 160)}\nWASM: ${actualBytes.slice(Math.max(0, first - 60), first + 160)}`)
}

function compare(fixture: Fixture, adapter: BroadRepulsionAdapter, options: Options, connMap?: ConnectivityMap): HighDensityRoute[] {
  const { name, srj: board, routes } = fixture
  const { effort, passes, sameNetVias, cleanup } = options
  const before = JSON.stringify({ board, routes, connMap })
  const expected = applyBroadRepulsionForcesTs(board, routes, effort, passes, connMap, sameNetVias, cleanup)
  const actual = adapter.run(routes, effort, passes, connMap, sameNetVias, cleanup)
  const label = `${name} ${JSON.stringify(options)}`
  checkBytes(actual, expected, label)
  assert.equal(actual === routes, expected === routes, `${label} unchanged-array identity`)
  assert.equal(JSON.stringify({ board, routes, connMap }), before, `${label} input mutation`)
  return actual
}

await loadBroadRepulsionBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
const defaultOptions: Options = { effort: 1, passes: 1, sameNetVias: false, cleanup: true }
const fixtures: Fixture[] = [
  { name: "empty", srj: srj(), routes: [] },
  { name: "unchanged-clear-route", srj: srj(), routes: [route("clear", [{ x: -2, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }])] },
]

// Adapted from high-density-repair03/tests/broad-repulsion-wide-trace-pad-query.test.ts
// and broad-repulsion-minimum-width-stability.test.ts. These exercise the source's
// actual copper widths and floating-point operation order at the clearance edge.
for (const wide of [false, true]) {
  fixtures.push({ name: wide ? "wide-trace-spatial-buckets" : "minimum-width-rounding",
    srj: srj([{ type: "rect", center: { x: 0, y: wide ? 1.6 : -0.5 }, width: 0.8, height: 1,
      layers: ["top"], connectedTo: ["foreign-pad"] }]),
    routes: [route("wide-trace", [
      { x: -2, y: wide ? 3.1 : 0.5, z: 0, pcb_port_id: "start" },
      { x: -0.5, y: wide ? 2.79 : 0.15, z: 0, insideJumperPad: false },
      { x: 0.5, y: wide ? 2.79 : 0.15, z: 0 },
      { x: 2, y: wide ? 3.1 : 0.5, z: 0, pcb_port_id: "end" },
    ], wide ? 1.2 : 0.1)],
  })
}
const viaRoutes: HighDensityRoute[] = [
  route("net_a", [
    { x: -2, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
    { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 },
    { x: 2, y: 0, z: 1, pcb_port_id: "pcb_port_end" },
  ]),
  route("net_b", [
    { x: -2, y: 0.2, z: 0 }, { x: 0.05, y: 0.2, z: 0 },
    { x: 0.05, y: 0.2, z: 1 }, { x: 2, y: 0.2, z: 1 },
  ]),
  route("net_c", [{ x: -1, y: -1, z: 0 }, { x: -0.1, y: 0.1, z: 0 }, { x: 1, y: 1, z: 0 }]),
]
viaRoutes[0]!.vias = [{ x: 0, y: 0 }]
viaRoutes[1]!.vias = [{ x: 0.05, y: 0.2 }]
fixtures.push({ name: "via-trace-live-point-references", srj: srj(), routes: viaRoutes })
fixtures.push({ name: "same-net-via-pairs", srj: srj(), routes: viaRoutes.map((value) => ({ ...structuredClone(value), rootConnectionName: "shared" })) })
fixtures.push({ name: "obstacles-multilayer-outline", srj: { ...srj([
  { type: "rect", center: { x: 0.1, y: 0.1 }, width: 0.2, height: 0.3, layers: ["top", "bottom"], connectedTo: ["foreign-pad"] },
  { type: "rect", center: { x: -2, y: 0 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["net_a"] },
]), outline: [{ x: -3, y: -2 }, { x: 3, y: -2 }, { x: 3, y: 5 }, { x: -3, y: 5 }] }, routes: structuredClone(viaRoutes) })

for (const fixture of fixtures) {
  const adapter = new BroadRepulsionAdapter(fixture.srj)
  const options: Options[] = [defaultOptions,
    { ...defaultOptions, cleanup: false },
    { ...defaultOptions, sameNetVias: true },
    { effort: 1.25, passes: 0.5, sameNetVias: true, cleanup: false },
    { ...defaultOptions, passes: 0 },
  ]
  for (const option of options) compare(fixture, adapter, option)
  const expected = applyBroadRepulsionForcesTs(fixture.srj, fixture.routes, 1)
  const throughRegisteredBackend = applyBroadRepulsionForces(fixture.srj, fixture.routes, 1)
  checkBytes(throughRegisteredBackend, expected, `${fixture.name} registered backend`)
  assert.equal(throughRegisteredBackend === fixture.routes, expected === fixture.routes)
  console.log(`${fixture.name}: ${options.length} direct runs and registered backend identical`)
}

// Mutate one map on the same adapter, then remove it, to exercise connectivity
// synchronization after construction without rebuilding the SRJ context.
const liveFixture = fixtures.find((fixture) => fixture.name === "minimum-width-rounding")!
const liveMap = new ConnectivityMap({})
const liveAdapter = new BroadRepulsionAdapter(liveFixture.srj, liveMap)
const disconnected = compare(liveFixture, liveAdapter, defaultOptions, liveMap)
liveMap.addConnections([["wide-trace", "foreign-pad"]])
const connected = compare(liveFixture, liveAdapter, defaultOptions, liveMap)
assert.notEqual(JSON.stringify(connected), JSON.stringify(disconnected), "live connectivity fixture must exercise a changed decision")
compare(liveFixture, liveAdapter, defaultOptions, undefined)
console.log("live connectivity: disconnected, joined, and removed maps identical")

// Optional realistic captured repair input, such as repair03's bugreport91
// fixture: --fixture <JSON containing srj and hdRoutes>.
const fixtureArg = process.argv.indexOf("--fixture")
if (fixtureArg !== -1) {
  const path = process.argv[fixtureArg + 1]
  assert.ok(path, "--fixture requires a path")
  const input = JSON.parse(readFileSync(path, "utf8")) as FixtureFile
  const connMap = new ConnectivityMap({})
  for (const connection of input.srj.connections) {
    const roots = (connection as typeof connection & { __rootConnectionNames?: string[] }).__rootConnectionNames ?? []
    connMap.addConnections([[connection.name, ...roots]])
  }
  for (const obstacle of input.srj.obstacles) {
    connMap.addConnections([[obstacle.obstacleId, ...obstacle.connectedTo].filter((id): id is string => Boolean(id))])
  }
  const fixture = { name: path, srj: input.srj, routes: input.hdRoutes }
  const adapter = new BroadRepulsionAdapter(input.srj, connMap)
  compare(fixture, adapter, defaultOptions, connMap)
  compare(fixture, adapter, { ...defaultOptions, cleanup: false, sameNetVias: true }, connMap)
  console.log(`${path}: captured fixture identical`)
}

const inputDirArg = process.argv.indexOf("--input-dir")
if (inputDirArg !== -1) {
  const directory = process.argv[inputDirArg + 1]
  assert.ok(directory, "--input-dir requires a directory")
  const files = readdirSync(directory).filter((name) => /^input-\d+\.json$/.test(name))
    .sort((left, right) => Number(left.slice(6, -5)) - Number(right.slice(6, -5)))
  assert.ok(files.length > 0, `No input-<number>.json files in ${directory}`)
  for (const file of files) {
    const input = JSON.parse(readFileSync(join(directory, file), "utf8")) as {
      srj: SimpleRouteJson; routes: HighDensityRoute[]; effort: number; passMultiplier: number
      connMap: { netMap: ConnectivityMap["netMap"]; idToNetMap: ConnectivityMap["idToNetMap"] } | null
      allowSameNetViaPairs: boolean; cleanup: boolean
    }
    const connMap = input.connMap === null ? undefined : Object.assign(new ConnectivityMap({}), input.connMap)
    const fixture = { name: file, srj: input.srj, routes: input.routes }
    const adapter = new BroadRepulsionAdapter(input.srj, connMap)
    compare(fixture, adapter, { effort: input.effort, passes: input.passMultiplier,
      sameNetVias: input.allowSameNetViaPairs, cleanup: input.cleanup }, connMap)
    console.log(`${file}: captured broad invocation identical`)
  }
}
