import assert from "node:assert/strict"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { getSvgFromGraphicsObject } from "graphics-debug"
import * as bindings from "../pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "../../../lib/bindings/initializeAutorouterBindings"
import { importReference } from "./tsReference"

type Kind = "single-layer" | "single-transition" | "through-obstacle"
type ReferenceSolver = {
  MAX_ITERATIONS: number; solved: boolean; failed: boolean; error: string | null
  iterations: number; progress: number; solvedRoutes: unknown[]
  step(): void; visualize(): any; [key: string]: any
}
type Fixture = { name: string; kind: Kind; params: any; mutate?: boolean }
const references: Record<Kind, new (params: any) => ReferenceSolver> = {
  "single-layer": (await importReference<any>("lib/solvers/HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver.ts")).SingleLayerNoDifferentRootIntersectionsIntraNodeSolver,
  "single-transition": (await importReference<any>("lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver.ts")).SingleTransitionIntraNodeSolver,
  "through-obstacle": (await importReference<any>("lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver.ts")).SingleTransitionThroughObstacleIntraNodeSolver,
}
const { ConnectivityMap } = await importReference<any>("node_modules/circuit-json-to-connectivity-map/dist/index.js")
const { safeTransparentize } = await importReference<any>("lib/solvers/colors.ts")
const node = {
  capacityMeshNodeId: "simple-parity", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
  portPoints: [
    { connectionName: "a", rootConnectionName: "root", portPointId: "start", nextPortPointId: "end", x: -2, y: 0, z: 0, pcb_port_id: "pcb-a" },
    { connectionName: "a", rootConnectionName: "root", portPointId: "end", prevPortPointId: "start", x: 2, y: 0, z: 1, pcb_port_id: "pcb-b" },
  ],
}
const obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 5, height: 5, layers: ["top", "bottom"], connectedTo: ["alias"], circuitJsonMetadata: { source_component_id: "c1", extra: "preserved" } }
const fixtures: Fixture[] = [
  { name: "transition", kind: "single-transition", params: { nodeWithPortPoints: node } },
  { name: "degenerate bounds clamp", kind: "single-transition", params: { nodeWithPortPoints: { ...node, width: 0.1, height: 0.1 }, viaDiameter: 0.6, obstacleMargin: 0.2 } },
  { name: "empty transition", kind: "single-transition", params: { nodeWithPortPoints: { ...node, portPoints: [] } } },
  { name: "same layer transition rejected", kind: "single-transition", params: { nodeWithPortPoints: { ...node, portPoints: node.portPoints.map((p) => ({ ...p, z: 0 })) } } },
  { name: "missing endpoint layer", kind: "single-transition", params: { nodeWithPortPoints: { ...node, portPoints: node.portPoints.map(({ z, ...p }) => p) } } },
  { name: "through connected alias", kind: "through-obstacle", params: { nodeWithPortPoints: node, obstacles: [obstacle], connMap: { netMap: { root: ["a", "alias"] }, idToNetMap: { a: "root", alias: "root" } } } },
  { name: "through unrelated obstacle", kind: "through-obstacle", params: { nodeWithPortPoints: node, obstacles: [obstacle] } },
  { name: "through layer normalization", kind: "through-obstacle", params: { nodeWithPortPoints: node, obstacles: [{ ...obstacle, connectedTo: ["a"], __zLayers: [-1, 1, 0, 1, 8] }] } },
  { name: "through no obstacles", kind: "through-obstacle", params: { nodeWithPortPoints: node } },
  { name: "through no root metadata", kind: "through-obstacle", params: { nodeWithPortPoints: { ...node, portPoints: node.portPoints.map(({ rootConnectionName, ...p }) => p) }, obstacles: [{ ...obstacle, connectedTo: ["a"] }] } },
]
const singleLayerNode = {
  ...node, availableZ: [0], portPoints: [
    { connectionName: "a", rootConnectionName: "common", portPointId: "a1", nextPortPointId: "a2", x: -2, y: 0, z: 0 },
    { connectionName: "a", rootConnectionName: "common", portPointId: "a2", prevPortPointId: "a1", nextPortPointId: "a3", x: 0, y: -2, z: 0 },
    { connectionName: "a", rootConnectionName: "common", portPointId: "a3", prevPortPointId: "a2", x: 2, y: 0, z: 0 },
    { connectionName: "b", rootConnectionName: "other", x: -1, y: 2, z: 0 },
    { connectionName: "b", rootConnectionName: "other", x: 1, y: 2, z: 0 },
  ],
}
fixtures.push(
  { name: "single layer linked roots", kind: "single-layer", params: { nodeWithPortPoints: singleLayerNode }, mutate: true },
  { name: "single layer reversed input", kind: "single-layer", params: { nodeWithPortPoints: { ...singleLayerNode, portPoints: [...singleLayerNode.portPoints].reverse() } } },
  { name: "single layer empty", kind: "single-layer", params: { nodeWithPortPoints: { ...node, portPoints: [], availableZ: [0] } } },
)
const captures = process.argv[2]
if (captures) {
  const manifest = JSON.parse(readFileSync(join(captures, "manifest.json"), "utf8")) as Array<{ kind: Kind; file: string; node: string; initialSolved: boolean }>
  for (const kind of Object.keys(references) as Kind[]) {
    for (const entry of manifest.filter((entry) => entry.kind === kind).sort((a, b) => Number(b.initialSolved) - Number(a.initialSolved)).filter((entry) => statSync(join(captures, entry.file)).size < 300000).slice(0, 2)) {
      fixtures.push({ name: `captured ${entry.node} ${entry.file}`, kind, params: JSON.parse(readFileSync(join(captures, entry.file), "utf8")) })
    }
  }
}
initializeAutorouterBindings()
let checks = 0
for (const fixture of fixtures) {
  const params = structuredClone(fixture.params)
  if (params.connMap) params.connMap = Object.assign(new ConnectivityMap({}), params.connMap)
  const expected = new references[fixture.kind](params)
  const actual = new bindings.SpecializedIntraNodeDispatcher(fixture.kind, JSON.stringify(fixture.params))
  const compare = (stage: string): void => {
    const state = JSON.parse(actual.stateJson())
    for (const key of Object.keys(state)) assert.deepEqual(state[key], expected[key], `${fixture.name} ${stage} ${key}`)
    assert.equal(JSON.stringify(JSON.parse(actual.solvedRoutesJson())), JSON.stringify(expected.solvedRoutes), `${fixture.name} ${stage} route bytes`)
    const snapshot = JSON.parse(actual.snapshotJson())
    for (const key of Object.keys(snapshot)) {
      assert.deepEqual(snapshot[key], JSON.parse(JSON.stringify(expected[key])), `${fixture.name} ${stage} snapshot ${key}`)
    }
    const graphics = JSON.parse(actual.visualizeJson(safeTransparentize))
    const referenceGraphics = expected.visualize()
    assert.equal(JSON.stringify(graphics), JSON.stringify(referenceGraphics), `${fixture.name} ${stage} graphics bytes`)
    assert.equal(getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }), getSvgFromGraphicsObject(referenceGraphics, { backgroundColor: "white" }), `${fixture.name} ${stage} SVG`)
    checks++
  }
  try {
    compare("constructor")
    if (fixture.mutate) {
      const snapshot = JSON.parse(actual.snapshotJson())
      snapshot.traceWidth = expected.traceWidth = 0.225
      snapshot.viaDiameter = expected.viaDiameter = 0.45
      snapshot.nodeWithPortPoints.portPoints[0].x += 0.01
      expected.nodeWithPortPoints.portPoints[0].x += 0.01
      actual.restoreJson(JSON.stringify(snapshot))
      compare("restore public mutation")
    }
    while (!expected.solved && !expected.failed) {
      actual.step(); expected.step()
      compare(`step ${expected.iterations}`)
      assert.ok(expected.iterations < 10, "Simple solver should finish in one step")
    }
    actual.step(); expected.step()
    compare("terminal no-op")
  } finally { actual.free() }
  console.log(`${fixture.kind}: ${fixture.name}`)
}
console.log(`Simple specialized parity: ${fixtures.length} fixtures, ${checks} constructor/step/restore/terminal checks`)
