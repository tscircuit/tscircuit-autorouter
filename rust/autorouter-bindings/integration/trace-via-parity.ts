import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { importReference } from "./tsReference"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "../../../lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import { SingleRouteUselessViaRemovalSolver } from "../../../lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import { SameNetViaMergerSolver } from "../../../lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import { ObstacleSpatialHashIndex } from "../../../lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "../../../lib/data-structures/HighDensityRouteSpatialIndex"
const referenceVia = await importReference<any>("lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver.ts")
const referenceSingle = await importReference<any>("lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver.ts")
const referenceMerger = await importReference<any>("lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver.ts")
const referenceObstacle = await importReference<any>("lib/data-structures/ObstacleTree.ts")
const referenceIndex = await importReference<any>("lib/data-structures/HighDensityRouteSpatialIndex.ts")

function runPair(name: string, actual: any, expected: any, output: string): void {
  let steps = 0
  while (!expected.solved && !expected.failed) {
    let actualError: unknown, expectedError: unknown
    try { actual.step() } catch (error) { actualError = error }
    try { expected.step() } catch (error) { expectedError = error }
    steps++
    if (actualError || expectedError) {
      const message = (error: any): string | undefined => error instanceof Error ? error.message : error?.toString()
      assert.equal(message(actualError), message(expectedError), `${name} step ${steps} thrown error`)
      console.log(`${name}: ${steps} exact steps then matching error ${message(actualError)}`)
      return
    }
    for (const field of ["iterations", "solved", "failed", "error", "progress", "MAX_ITERATIONS"]) {
      assert.deepEqual(actual[field], expected[field], `${name} step ${steps} ${field}`)
    }
    const a = JSON.stringify(actual[output]()), b = JSON.stringify(expected[output]())
    if (a !== b) {
      const outputDirectory = mkdtempSync(join(tmpdir(), "trace-via-parity-"))
      writeFileSync(join(outputDirectory, "actual.json"), a)
      writeFileSync(join(outputDirectory, "expected.json"), b)
      let offset = 0
      while (a[offset] === b[offset]) offset++
      throw new Error(`${name} step ${steps} output offset ${offset}: ${a.slice(offset - 70, offset + 100)} versus ${b.slice(offset - 70, offset + 100)}; artifacts: ${outputDirectory}`)
    }
    if (steps > 100000) throw new Error(`${name} did not terminate`)
  }
  console.log(`${name}: ${steps} exact public steps`)
}

const small = { connectionName: "net", rootConnectionName: "net", traceThickness: 0.1, viaDiameter: 0.3,
  route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }, { x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
  vias: [{ x: 1, y: 0 }, { x: 2, y: 0 }] }
const fixtures: Array<{ name: string; input: any }> = [{ name: "small", input: { unsimplifiedHdRoutes: [small], obstacles: [], layerCount: 2, colorMap: { net: "red" }, connMap: { netMap: { net: ["net"] }, idToNetMap: { net: "net" } } } }]
if (process.env.TRACE_SIMPLIFICATION_FIXTURE) fixtures.push({ name: "board", input: JSON.parse(readFileSync(process.env.TRACE_SIMPLIFICATION_FIXTURE, "utf8"), (_key, value) => value?.$map ? new Map(value.$map) : value?.$set ? new Set(value.$set) : value) })
for (const fixture of fixtures) {
  const make = (): any => {
    const input = structuredClone(fixture.input)
    const connMap = new ConnectivityMap({})
    Object.assign(connMap, input.connMap)
    return { ...input, unsimplifiedHdRoutes: input.unsimplifiedHdRoutes ?? input.hdRoutes, connMap }
  }
  const actualVia = new UselessViaRemovalSolver(make())
  const expectedVia = new referenceVia.UselessViaRemovalSolver(make())
  runPair(`${fixture.name}/via`, actualVia, expectedVia, "getOptimizedHdRoutes")
  runPair(`${fixture.name}/merger`, new SameNetViaMergerSolver({ ...make(), inputHdRoutes: actualVia.getOptimizedHdRoutes()! }), new referenceMerger.SameNetViaMergerSolver({ ...make(), inputHdRoutes: expectedVia.getOptimizedHdRoutes() }), "getMergedViaHdRoutes")
  for (const kind of ["native", "rbush", "flatbush"] as const) {
    const a = make(), b = make()
    if (a.unsimplifiedHdRoutes.length === 0) continue
    const actual = new SingleRouteUselessViaRemovalSolver({ ...a, unsimplifiedRoute: a.unsimplifiedHdRoutes[0], obstacleSHI: new ObstacleSpatialHashIndex(kind, a.obstacles), hdRouteSHI: new HighDensityRouteSpatialIndex(a.unsimplifiedHdRoutes) })
    const expected = new referenceSingle.SingleRouteUselessViaRemovalSolver({ ...b, unsimplifiedRoute: b.unsimplifiedHdRoutes[0], obstacleSHI: new referenceObstacle.ObstacleSpatialHashIndex(kind, b.obstacles), hdRouteSHI: new referenceIndex.HighDensityRouteSpatialIndex(b.unsimplifiedHdRoutes) })
    const original = actual.unsimplifiedRoute
    assert.equal(actual.getConstructorParams().unsimplifiedRoute, original)
    if (fixture.name === "small") {
      original.route[1].x = 1.1
      expected.unsimplifiedRoute.route[1].x = 1.1
      actual.PRESERVE_ROUTE_ENDPOINTS = true
      expected.PRESERVE_ROUTE_ENDPOINTS = true
    }
    runPair(`${fixture.name}/single/${kind}`, actual, expected, "getOptimizedHdRoute")
  }
}
