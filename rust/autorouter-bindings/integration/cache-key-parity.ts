import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CachedIntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { importReference } from "./tsReference"

const { CachedIntraNodeRouteSolver: Reference } = await importReference<typeof import("../../../lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver")>("lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver.ts")
type Solver = CachedIntraNodeRouteSolver
type Props = ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]
type Mutation = { name: string; change: (solver: Solver) => void; effect?: "same" | "different" }
const props: Props = {
  cacheProvider: null,
  nodeWithPortPoints: {
    capacityMeshNodeId: "cache-normalization", center: { x: 0.125, y: -0.125 }, width: 6, height: 8,
    availableZ: [10, 2, 0],
    portPoints: [
      { connectionName: "netA", rootConnectionName: "rootA", portPointId: "p2", x: -1, y: 2, z: 0 },
      { connectionName: "netA", rootConnectionName: "rootA", portPointId: "p10", x: 3, y: -2, z: 2 },
      { connectionName: "netB", portPointId: "p4", x: -2, y: 3, z: 0 },
      { connectionName: "netB", portPointId: "p3", x: 2, y: -3, z: 10 },
    ],
  }, hyperParameters: { CELL_SIZE_FACTOR: 1, SHUFFLE_SEED: 3 },
}

function pair(input: Props = props): [Solver, Solver] {
  return [new CachedIntraNodeRouteSolver(structuredClone(input)), new Reference(structuredClone(input))]
}
let comparisons = 0
function compare(actual: Solver, expected: Solver, label: string): string {
  const beforeActual = actual.cacheToSolveSpaceTransform
  const beforeExpected = expected.cacheToSolveSpaceTransform
  const beforePorts = structuredClone(actual.nodeWithPortPoints.portPoints)
  const beforeConnections = structuredClone(actual.initialUnsolvedConnections)
  const a = actual.computeCacheKeyAndTransform()
  const b = expected.computeCacheKeyAndTransform()
  assert.equal(a.cacheKey, b.cacheKey, label)
  assert.equal(actual.cacheKey, a.cacheKey, `${label}: public key assignment`)
  assert.equal(actual.cacheToSolveSpaceTransform, a.cacheToSolveSpaceTransform, `${label}: returned transform identity`)
  assert.notEqual(a.cacheToSolveSpaceTransform, beforeActual, `${label}: fresh actual transform`)
  assert.notEqual(b.cacheToSolveSpaceTransform, beforeExpected, `${label}: fresh reference transform`)
  assert.deepEqual(a.cacheToSolveSpaceTransform, {})
  assert.deepEqual(actual.nodeWithPortPoints.portPoints, beforePorts, `${label}: port sorting must not mutate input`)
  assert.deepEqual(actual.initialUnsolvedConnections, beforeConnections, `${label}: connections must not mutate input`)
  comparisons++
  return a.cacheKey
}

const mutations: Mutation[] = [
  { name: "port order", change: (s): void => { s.nodeWithPortPoints.portPoints.reverse() }, effect: "same" },
  { name: "layer lexical ordering", change: (s): void => { s.nodeWithPortPoints.availableZ!.reverse() }, effect: "same" },
  { name: "dimension below rounding threshold", change: (s): void => { s.nodeWithPortPoints.width = 6.001 }, effect: "same" },
  { name: "dimension above rounding threshold", change: (s): void => { s.nodeWithPortPoints.width = 6.003 }, effect: "different" },
  { name: "live center", change: (s): void => { s.nodeWithPortPoints.center.x += 0.01 }, effect: "different" },
  { name: "live port coordinate", change: (s): void => { s.nodeWithPortPoints.portPoints[0]!.x += 0.01 }, effect: "different" },
  { name: "live port metadata", change: (s): void => { s.nodeWithPortPoints.portPoints[0]!.prevPortPointId = "previous" }, effect: "different" },
  { name: "initial connection coordinates", change: (s): void => { s.initialUnsolvedConnections[0]!.points[0]!.y += 0.02 }, effect: "different" },
  { name: "initial connection order", change: (s): void => { s.initialUnsolvedConnections.reverse() }, effect: "different" },
  { name: "live unsolved queue excluded", change: (s): void => { s.unsolvedConnections = [] }, effect: "same" },
  { name: "explicit undefined hyperparameter", change: (s): void => { s.hyperParameters.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR = undefined }, effect: "same" },
  { name: "mutable clearance", change: (s): void => { s.obstacleMargin = 0.225 }, effect: "different" },
  { name: "mutable entry distance", change: (s): void => { s.minDistBetweenEnteringPoints += 0.01 }, effect: "different" },
]
for (const mutation of mutations) {
  const [actual, expected] = pair()
  const original = compare(actual, expected, `${mutation.name}: before`)
  mutation.change(actual); mutation.change(expected)
  const changed = compare(actual, expected, `${mutation.name}: after`)
  if (mutation.effect === "same") assert.equal(changed, original, mutation.name)
  if (mutation.effect === "different") assert.notEqual(changed, original, mutation.name)
  compare(actual, expected, `${mutation.name}: repeated`)
}

const [actual, expected] = pair()
for (const value of [undefined, null, 0, -0, 0.0025, -0.0025, 0.0024999999999999996, -0.0025000000000000005, NaN, Infinity, -Infinity, 1e-7, 1e21]) {
  for (const solver of [actual, expected]) {
    ;(solver.hyperParameters as Record<string, unknown>).FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR = value
    solver.traceWidth = typeof value === "number" ? value : 0.15
  }
  compare(actual, expected, `exceptional numeric value ${String(value)}`)
}
for (const value of [undefined, null, {}, { SHUFFLE_SEED: undefined }, { SHUFFLE_SEED: null }]) {
  for (const solver of [actual, expected]) solver.hyperParameters = value as Solver["hyperParameters"]
  compare(actual, expected, `hyperparameter container ${JSON.stringify(value)}`)
}

for (const names of [["é", "e\u0301", "E", "ä", "漢字", "😀", "\ud800", "\udfff"], ["2", "10", "01", "__proto__", "constructor", "toString"]]) {
  const input = structuredClone(props)
  input.nodeWithPortPoints.portPoints = names.flatMap((connectionName, i) => [
    { connectionName, portPointId: `${names[names.length - i - 1]}-2`, x: i + 0.0025, y: -i - 0.0025, z: i % 3 },
    { connectionName, portPointId: `${names[names.length - i - 1]}-10`, x: i + 1, y: -i - 1, z: i % 3 },
  ])
  const [a, b] = pair(input)
  for (const solver of [a, b]) {
    solver.hyperParameters = Object.fromEntries(names.map((name, i) => [name, i]))
    solver.connMap = new ConnectivityMap(Object.fromEntries(names.map((name) => [name, ["z", "2", name, "10", name, "😀"]])))
  }
  const original = compare(a, b, `Unicode/key normalization ${JSON.stringify(names)}`)
  for (const solver of [a, b]) {
    solver.connMap = new ConnectivityMap(Object.fromEntries(names.map((name) => [name, ["😀", "10", name, "2", "z"]])))
  }
  assert.equal(compare(a, b, "reordered/deduplicated connectivity"), original)
  for (const solver of [a, b]) {
    solver.nodeWithPortPoints.portPoints.reverse()
    solver.hyperParameters = Object.fromEntries(Object.entries(solver.hyperParameters).reverse())
  }
  // localeCompare can equate distinct Unicode spellings. Its stable sort then
  // deliberately preserves input order, so reordering need not preserve a key.
  compare(a, b, "stable Unicode locale ties after reordering")
  for (const solver of [a, b]) solver.connMap = new ConnectivityMap(Object.fromEntries(names.map((name) => [name, ["new-member"]])))
  assert.notEqual(compare(a, b, "live connectivity membership"), original)
}
// Exercise short and long UTF-16 strings, including embedded NULs and both
// paired and unpaired surrogates. Reuse the same strings across roles.
for (const length of [511, 512, 513, 65535, 65536]) {
  const shared = "a\0😀\ud800x\udfff".padEnd(length, "q")
  const input = structuredClone(props)
  for (const point of input.nodeWithPortPoints.portPoints) {
    point.connectionName = shared
    point.rootConnectionName = shared
    point.portPointId = shared
    point.prevPortPointId = shared
    point.nextPortPointId = shared
  }
  const [a, b] = pair(input)
  for (const solver of [a, b]) {
    solver.hyperParameters = { [shared]: 0.125 }
    solver.connMap = new ConnectivityMap({ [shared]: [shared, `${shared}\0`, shared] })
  }
  compare(a, b, `long UTF16 shared roles length ${length}`)
}

const growthInput = structuredClone(props)
growthInput.nodeWithPortPoints.portPoints = Array.from({ length: 384 }, (_, i) => ({
  connectionName: `growth-${Math.floor(i / 2)}`,
  rootConnectionName: `root-${i % 13}`,
  portPointId: `port-${i}\0${"p".repeat(i % 97)}`,
  prevPortPointId: `previous-${i}`,
  nextPortPointId: `next-${i}`,
  x: (i % 31) / 200, y: -(i % 29) / 200, z: i % 3,
}))
const [growthActual, growthExpected] = pair(growthInput)
compare(growthActual, growthExpected, "many distinct connection and port strings")
for (const solver of [growthActual, growthExpected]) {
  solver.nodeWithPortPoints.portPoints.reverse()
  solver.initialUnsolvedConnections.splice(3, 5)
}
compare(growthActual, growthExpected, "fewer connections after a larger input")

const [aliasActual, aliasExpected] = pair()
for (const solver of [aliasActual, aliasExpected]) {
  solver.initialUnsolvedConnections[0]!.points[0] = solver.nodeWithPortPoints.portPoints[0]!
}
const aliasKey = compare(aliasActual, aliasExpected, "shared coordinate object across roles")
for (const solver of [aliasActual, aliasExpected]) {
  const retained = solver.nodeWithPortPoints.portPoints[0]!
  retained.x += 0.025
  retained.prevPortPointId = "changed\0😀\ud800"
}
assert.notEqual(compare(aliasActual, aliasExpected, "live mutation through retained alias"), aliasKey)

const [outerActual, outerExpected] = pair()
const [innerActual, innerExpected] = pair(growthInput)
let reentrantCalls = 0
for (const solver of [outerActual, outerExpected]) {
  const connMap = new ConnectivityMap({ netA: ["rootA", "shared"], netB: ["shared"] })
  const original = connMap.getIdsConnectedToNet.bind(connMap)
  connMap.getIdsConnectedToNet = (name: string): ReturnType<typeof original> => {
    reentrantCalls++
    compare(innerActual, innerExpected, "nested compute during connectivity read")
    return original(name)
  }
  solver.connMap = connMap
}
compare(outerActual, outerExpected, "reentrant outer compute")
assert.ok(reentrantCalls > 0)

// Connectivity is read after coordinate normalization but before the final
// node/scalar snapshot. Side effects must preserve those two observation times.
const [sideEffectActual, sideEffectExpected] = pair()
for (const solver of [sideEffectActual, sideEffectExpected]) {
  const connMap = new ConnectivityMap({ netA: ["rootA"], netB: ["rootB"] })
  let calls = 0
  connMap.getIdsConnectedToNet = (name: string): string[] => {
    calls++
    solver.traceWidth += 0.025
    solver.nodeWithPortPoints.width += 0.5
    solver.nodeWithPortPoints.height += 0.25
    solver.nodeWithPortPoints.center.x += 0.125
    solver.nodeWithPortPoints.center.y -= 0.25
    solver.nodeWithPortPoints.availableZ = [calls, 10, 2]
    return [name, "alias"]
  }
  solver.connMap = connMap
}
compare(sideEffectActual, sideEffectExpected, "connectivity side effects preserve scalar read timing")
compare(sideEffectActual, sideEffectExpected, "repeated compute after connectivity side effects")

const surrogateInput = structuredClone(props)
const surrogateNames = ["\ud800".repeat(150000) + "a", "\ud800".repeat(150000) + "b"]
surrogateInput.nodeWithPortPoints.portPoints = surrogateNames.flatMap((connectionName, i) => [
  { connectionName, portPointId: "start", x: -1, y: i, z: 0 },
  { connectionName, portPointId: "end", x: 1, y: i, z: 0 },
])
const [surrogateActual, surrogateExpected] = pair(surrogateInput)
compare(surrogateActual, surrogateExpected, "large lone-surrogate locale comparison")

const [invalidActual, invalidExpected] = pair()
const validKey = compare(invalidActual, invalidExpected, "before invalid scalar")
const validTransform = invalidActual.cacheToSolveSpaceTransform
;(invalidActual.hyperParameters as Record<string, unknown>).CELL_SIZE_FACTOR = { cacheScalar: "NaN" }
assert.throws(() => invalidActual.computeCacheKeyAndTransform())
assert.equal(invalidActual.cacheKey, validKey, "invalid scalar cannot assign a fallback cache key")
assert.equal(invalidActual.cacheToSolveSpaceTransform, validTransform, "invalid scalar cannot replace the last transform")
invalidActual.hyperParameters.CELL_SIZE_FACTOR = invalidExpected.hyperParameters.CELL_SIZE_FACTOR
assert.equal(compare(invalidActual, invalidExpected, "compute recovers after rejected scalar"), validKey)

console.log(`Cache normalization: ${comparisons} frozen-reference comparisons, mutations and transform identities`)
