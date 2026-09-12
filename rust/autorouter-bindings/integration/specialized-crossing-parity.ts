import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { importReference } from "./tsReference"
import * as bindings from "../pkg/autorouter_bindings.js"
import { loadAutorouterBindings } from "../ts/index"

type Point = { x: number; y: number; z: number; connectionName: string; rootConnectionName?: string; portPointId?: string }
type Props = { nodeWithPortPoints: { capacityMeshNodeId: string; center: { x: number; y: number }; width: number; height: number; availableZ?: number[]; portPoints: Point[] }; viaDiameter?: number; traceThickness?: number; obstacleMargin?: number; layerCount?: number }
type ReferenceSolver = { solved: boolean; failed: boolean; iterations: number; error?: string | null; solvedRoutes: unknown[]; step(): void; visualize(): unknown; [key: string]: unknown }
type ReferenceConstructor = new (props: Props) => ReferenceSolver
type Kind = "two-crossing" | "transition-crossing"
const { TwoCrossingRoutesHighDensitySolver: TwoCrossing } = await importReference<{ TwoCrossingRoutesHighDensitySolver: ReferenceConstructor }>("lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver.ts")
const { SingleTransitionCrossingRouteSolver: TransitionCrossing } = await importReference<{ SingleTransitionCrossingRouteSolver: ReferenceConstructor }>("lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver.ts")
await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
let comparisons = 0
function bytes(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) {
    let i = 0
    while (i < Math.min(a.length, e.length) && a[i] === e[i]) i++
    assert.fail(`${label}: byte ${i}\nRust ${a.slice(Math.max(0, i - 80), i + 220)}\nTS   ${e.slice(Math.max(0, i - 80), i + 220)}`)
  }
  comparisons++
}
function fixture(name: string, kind: Kind, props: Props, restore = false): void {
  const inputBytes = JSON.stringify(props)
  const expected = new (kind === "two-crossing" ? TwoCrossing : TransitionCrossing)(structuredClone(props))
  const actual = new bindings.SpecializedIntraNodeDispatcher(kind, props)
  function compare(label: string): void {
    const snapshot = actual.snapshot()
    for (const [key, value] of Object.entries(snapshot)) {
      bytes(value, expected[key] ?? (value === null ? null : expected[key]), `${name}/${label}/${key}`)
    }
    const state = actual.state()
    for (const [key, value] of Object.entries(state)) bytes(value, expected[key] ?? null, `${name}/${label}/state.${key}`)
    bytes(actual.solvedRoutes(), expected.solvedRoutes, `${name}/${label}/route bytes`)
    if ((snapshot.routes as unknown[]).length === 2) bytes(actual.visualize(() => { throw new Error("Crossing visualization must not use a color callback") }), expected.visualize(), `${name}/${label}/visualization`)
  }
  try {
    compare("constructor")
    if (restore) {
      const snapshot = actual.snapshot()
      snapshot.obstacleMargin = 0.13
      snapshot.traceThickness = 0.12
      expected.obstacleMargin = 0.13
      expected.traceThickness = 0.12
      actual.restore(snapshot)
      compare("restored mutable settings")
    }
    for (let i = 0; i < 5 && !expected.solved && !expected.failed; i++) {
      expected.step()
      actual.step()
      compare(`step ${i + 1}`)
    }
    assert.ok(expected.solved || expected.failed, `${name}: fixture must terminate`)
    actual.step(); expected.step(); compare("terminal repeat")
    assert.equal(JSON.stringify(props), inputBytes, `${name}: input unchanged`)
    console.log(`${name}: identical states, routes and graphics`)
  } finally { actual.free() }
}
function crossing(transition: boolean): Props {
  return { nodeWithPortPoints: { capacityMeshNodeId: "crossing-parity", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [
    { x: -2, y: -1, z: 0, connectionName: "A", rootConnectionName: "root-A", portPointId: "A1" },
    { x: 2, y: 1, z: transition ? 1 : 0, connectionName: "A", rootConnectionName: "root-A", portPointId: "A2" },
    { x: -1, y: 2, z: 0, connectionName: "B", rootConnectionName: "root-B", portPointId: "B1" },
    { x: 1, y: -2, z: 0, connectionName: "B", rootConnectionName: "root-B", portPointId: "B2" },
  ] } }
}
for (const kind of ["two-crossing", "transition-crossing"] as const) {
  const base = crossing(kind === "transition-crossing")
  fixture(`${kind}/crossing`, kind, base)
  fixture(`${kind}/restored`, kind, base, true)
  const reverse = structuredClone(base); reverse.nodeWithPortPoints.portPoints.reverse()
  fixture(`${kind}/reversed`, kind, reverse)
  const layers = structuredClone(base); layers.layerCount = 4; layers.nodeWithPortPoints.availableZ = [0, 1, 2, 3]
  for (const p of layers.nodeWithPortPoints.portPoints) p.z = p.z === 0 ? 3 : 0
  fixture(`${kind}/layers`, kind, layers)
  const direct = structuredClone(base)
  direct.nodeWithPortPoints.portPoints[1]!.y = -1.5
  direct.nodeWithPortPoints.portPoints[2]!.x = -2
  direct.nodeWithPortPoints.portPoints[2]!.y = 1
  direct.nodeWithPortPoints.portPoints[3]!.x = 2
  direct.nodeWithPortPoints.portPoints[3]!.y = 1.5
  fixture(`${kind}/noncrossing`, kind, direct)
  for (const size of [0.4, 0.8, 1.3, 2.1, 8]) {
    const scaled = structuredClone(base); scaled.nodeWithPortPoints.width = size; scaled.nodeWithPortPoints.height = size
    for (const p of scaled.nodeWithPortPoints.portPoints) { p.x *= size / 4; p.y *= size / 4 }
    fixture(`${kind}/size-${size}`, kind, scaled)
  }
  const wrongCount = structuredClone(base); wrongCount.nodeWithPortPoints.portPoints.splice(2)
  fixture(`${kind}/wrong-count`, kind, wrongCount)
}
// Existing captured SRJ18 cmn_70 regression fixture, retained with its routing rules.
const cmn70 = JSON.parse(readFileSync(new URL("../../../tests/fixtures/srj18-cmn70-single-transition-boundary-tolerance.json", import.meta.url), "utf8")) as { nodeWithPortPoints: Props["nodeWithPortPoints"]; routingRules: { layerCount: number; traceWidth: number; viaDiameter: number; obstacleMargin: number } }
fixture("cmn70", "transition-crossing", { nodeWithPortPoints: cmn70.nodeWithPortPoints, layerCount: cmn70.routingRules.layerCount, traceThickness: cmn70.routingRules.traceWidth, viaDiameter: cmn70.routingRules.viaDiameter, obstacleMargin: cmn70.routingRules.obstacleMargin })
// Boundary offsets follow single-transition-crossing-route-boundary-tolerance.test.ts.
for (const offset of [-1.1e-6, -0.5e-6, 0, 0.5e-6, 1.1e-6]) {
  const props = crossing(true); props.nodeWithPortPoints.portPoints[0]!.x -= offset
  fixture(`transition/boundary-${offset}`, "transition-crossing", props)
}
console.log(`${comparisons} exact crossing state, route and visualization comparisons passed`)
