import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import * as bindings from "../pkg/autorouter_bindings.js"
import { loadAutorouterBindings } from "../ts/index"
import { importReference } from "./tsReference"
import { safeTransparentize } from "../../../lib/solvers/colors"

type Kind = "multi-head" | "multi-head2" | "multi-head3" | "via-possibilities2"
type JsonObject = Record<string, any>
type ReferenceSolver = JsonObject & { step(): void; visualize(): unknown }
type Constructor = new (params: JsonObject) => ReferenceSolver
const directory = "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/"
const constructors: Record<Kind, Constructor> = {
  "multi-head": (await importReference<{ MultiHeadPolyLineIntraNodeSolver: Constructor }>(directory + "MultiHeadPolyLineIntraNodeSolver.ts")).MultiHeadPolyLineIntraNodeSolver,
  "multi-head2": (await importReference<{ MultiHeadPolyLineIntraNodeSolver2: Constructor }>(directory + "MultiHeadPolyLineIntraNodeSolver2_Optimized.ts")).MultiHeadPolyLineIntraNodeSolver2,
  "multi-head3": (await importReference<{ MultiHeadPolyLineIntraNodeSolver3: Constructor }>(directory + "MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration.ts")).MultiHeadPolyLineIntraNodeSolver3,
  "via-possibilities2": (await importReference<{ ViaPossibilitiesSolver2: Constructor }>("lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2.ts")).ViaPossibilitiesSolver2,
}
await loadAutorouterBindings()

function transport(value: unknown): any {
  return JSON.parse(JSON.stringify(value, (_key, item): unknown => {
    if (item instanceof Map) return Object.fromEntries(item)
    if (item instanceof Set) return [...item]
    return item
  }))
}

function candidate(value: JsonObject | null | undefined): unknown {
  if (!value) return value
  const result = { ...value }
  if (value.forces) result.forces = value.forces.map((line: any[]) => line.map((force) =>
    force instanceof Map ? [...force.entries()] : Object.entries(force)))
  return transport(result)
}

function compare(binding: bindings.SpecializedIntraNodeDispatcher, reference: ReferenceSolver, kind: Kind, label: string): void {
  const snapshot = binding.snapshot()
  for (const key of ["iterations", "MAX_ITERATIONS", "solved", "failed", "error", "progress"]) {
    assert.deepEqual(snapshot[key], transport(reference[key]), `${label}/${key}`)
  }
  if (kind === "via-possibilities2") {
    for (const key of ["completedPaths", "placeholderPaths", "currentHead", "currentConnectionName", "currentPath", "currentViaCount", "unprocessedConnections", "stats"]) {
      assert.deepEqual(snapshot[key], transport(reference[key]), `${label}/${key}`)
    }
    assert.deepEqual(Object.keys(snapshot.completedPaths), [...reference.completedPaths.keys()], `${label}/completed map order`)
    assert.deepEqual(Object.keys(snapshot.placeholderPaths), [...reference.placeholderPaths.keys()], `${label}/placeholder map order`)
  } else {
    for (const key of ["phase", "minViaCount", "maxViaCount", "availableZ", "uniqueConnections", "bounds"]) {
      assert.deepEqual(snapshot[key], transport(reference[key]), `${label}/${key}`)
    }
    assert.deepEqual(snapshot.candidates.map(candidate), reference.candidates.map(candidate), `${label}/candidates`)
    assert.deepEqual(candidate(snapshot.lastCandidate), candidate(reference.lastCandidate), `${label}/lastCandidate`)
    assert.equal(JSON.stringify(binding.solvedRoutes()), JSON.stringify(reference.solvedRoutes), `${label}/route bytes`)
  }
}

const crossing = {
  capacityMeshNodeId: "node1", center: { x: 5, y: 5 }, width: 2, height: 2,
  portPoints: [
    { connectionName: "A", x: 4, y: 4, z: 0 }, { connectionName: "A", x: 6, y: 6, z: 0 },
    { connectionName: "B", x: 4, y: 6, z: 0 }, { connectionName: "B", x: 6, y: 4, z: 0 },
  ],
}
const cases: Array<{ name: string; params: JsonObject; kinds: Kind[] }> = [
  { name: "hdpolyline01", params: { nodeWithPortPoints: crossing }, kinds: ["multi-head", "multi-head2", "multi-head3", "via-possibilities2"] },
  { name: "duplicate-points", params: { nodeWithPortPoints: { ...crossing, portPoints: [crossing.portPoints[0], crossing.portPoints[0], ...crossing.portPoints.slice(1)] } }, kinds: ["multi-head", "multi-head2", "multi-head3", "via-possibilities2"] },
  { name: "layer-change", params: { nodeWithPortPoints: { ...crossing, availableZ: [0, 1], portPoints: [{ connectionName: "A", x: 4, y: 5, z: 0 }, { connectionName: "A", x: 6, y: 5, z: 1 }] } }, kinds: ["multi-head", "multi-head2", "multi-head3", "via-possibilities2"] },
  { name: "hdpolyline09-optimized", params: { nodeWithPortPoints: JSON.parse(readFileSync("fixtures/legacy/assets/cn27515-nodeWithPortPoints.json", "utf8")).nodeWithPortPoints, hyperParameters: { SEGMENTS_PER_POLYLINE: 4 } }, kinds: ["multi-head2", "multi-head3"] },
]
for (const [name, asset, hyperParameters] of [
  ["hdpolyline04", "cn48169", { BOUNDARY_PADDING: -0.1 }],
  ["hdpolyline05", "cn8724", {}],
  ["hdpolyline06", "cn62169", {}],
  ["hdpolyline07", "cn38186", {}],
] as const) {
  cases.push({ name, params: { nodeWithPortPoints: JSON.parse(readFileSync(`fixtures/legacy/assets/${asset}-nodeWithPortPoints.json`, "utf8")).nodeWithPortPoints, hyperParameters }, kinds: ["multi-head", "multi-head2"] })
}
cases.push({ name: "same-net-coincident", params: {
  nodeWithPortPoints: { ...crossing, portPoints: [
    { connectionName: "A", x: 4, y: 4, z: 0 }, { connectionName: "A", x: 6, y: 4, z: 0 },
    { connectionName: "B", x: 4, y: 4, z: 0 }, { connectionName: "B", x: 6, y: 4, z: 0 },
  ] }, connMap: transport(new ConnectivityMap({ net0: ["A", "B"] })),
}, kinds: ["multi-head", "multi-head2", "multi-head3"] })
for (const seed of [1, 13]) {
  cases.push({ name: `five-connections-shuffle-${seed}`, params: {
    nodeWithPortPoints: { ...crossing, portPoints: Array.from({ length: 5 }, (_, i) => [
      { connectionName: `net${i}`, x: 4, y: 4.25 + i * 0.3, z: 0 },
      { connectionName: `net${i}`, x: 6, y: 4.25 + i * 0.3, z: 0 },
    ]).flat() }, hyperParameters: { SHUFFLE_SEED: seed },
  }, kinds: ["via-possibilities2"] })
}
const captureDir = process.env.SPECIALIZED_CAPTURE_DIR
if (captureDir) {
  for (const file of readdirSync(captureDir).filter((name) => name.startsWith("multi-head3-")).sort().slice(0, 3)) {
    cases.push({ name: file, params: JSON.parse(readFileSync(join(captureDir, file), "utf8")), kinds: ["multi-head3"] })
  }
}
let totalSteps = 0
for (const fixture of cases) {
  if (process.env.SPECIALIZED_FIXTURE && !fixture.name.includes(process.env.SPECIALIZED_FIXTURE)) continue
  for (const kind of fixture.kinds) {
    if (process.env.SPECIALIZED_KIND && kind !== process.env.SPECIALIZED_KIND) continue
    const props = structuredClone(fixture.params)
    if (props.connMap) {
      const map = new ConnectivityMap({})
      Object.assign(map, props.connMap)
      props.connMap = map
    }
    const reference = new constructors[kind](props)
    const binding = new bindings.SpecializedIntraNodeDispatcher(kind, fixture.params)
    try {
      compare(binding, reference, kind, `${fixture.name}/${kind}/initial`)
      // Restoring untouched state must preserve the variant's overrides and math hooks.
      binding.restore(binding.snapshot())
      compare(binding, reference, kind, `${fixture.name}/${kind}/restore`)
      while (!reference.solved && !reference.failed) {
        reference.step()
        binding.step()
        totalSteps++
        compare(binding, reference, kind, `${fixture.name}/${kind}/${reference.iterations}`)
      }
      assert.deepEqual(binding.visualize(safeTransparentize), transport(reference.visualize()), `${fixture.name}/${kind}/graphics`)
      console.log(`${fixture.name}/${kind}: ${reference.iterations} steps, exact state, routes, and graphics`)
    } finally {
      binding.free()
    }
  }
}
console.log(`Specialized MultiHead/Via2 parity passed: ${totalSteps} steps`)
