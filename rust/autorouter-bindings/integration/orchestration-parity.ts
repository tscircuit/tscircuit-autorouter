import assert from "node:assert/strict"
import { HighDensitySolver } from "../../../lib/solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "../../../lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { InMemoryCache } from "../../../lib/cache/InMemoryCache"
import type { NodeWithPortPoints } from "../../../lib/types/high-density-types"
import { importReference } from "./tsReference"

const { HighDensitySolver: ReferenceBoard } = await importReference<{ HighDensitySolver: typeof HighDensitySolver }>("lib/solvers/HighDensitySolver/HighDensitySolver.ts")
const { GrowShrinkHighDensityIntraNodeSolver: ReferenceGrowth } = await importReference<{ GrowShrinkHighDensityIntraNodeSolver: typeof GrowShrinkHighDensityIntraNodeSolver }>("lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver.ts")
type Solver = HighDensitySolver | GrowShrinkHighDensityIntraNodeSolver
type Child = { getSolverName(): string; iterations: number; solved: boolean; failed: boolean; error: string | null; progress: number; solvedRoutes: unknown[]; nodeWithPortPoints: NodeWithPortPoints }
type Event = ["get", string] | ["set", string, unknown]
class RecordingCache extends InMemoryCache {
  readonly events: Event[] = []
  override getCachedSolutionSync(key: string): unknown { this.events.push(["get", key]); return super.getCachedSolutionSync(key) }
  override setCachedSolutionSync(key: string, value: unknown): void { this.events.push(["set", key, structuredClone(value)]); super.setCachedSolutionSync(key, value) }
}
function install(cache: RecordingCache): void { globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = cache }
function json(value: unknown): string { return JSON.stringify(value, (_key, entry: unknown): unknown => entry instanceof Map ? Object.fromEntries(entry) : entry) }
function child(value: Child | null | undefined): unknown {
  return value == null ? null : { name: value.getSolverName(), iterations: value.iterations, solved: value.solved,
    failed: value.failed, error: value.error, progress: value.progress, routes: value.solvedRoutes, node: value.nodeWithPortPoints }
}
function view(solver: Solver): unknown {
  const base = { iterations: solver.iterations, solved: solver.solved, failed: solver.failed, error: solver.error,
    progress: solver.progress, stats: solver.stats, active: child(solver.activeSubSolver), failedChildren: solver.failedSolvers.map(child) }
  return solver instanceof HighDensitySolver || solver instanceof ReferenceBoard
    ? { ...base, routes: (solver as HighDensitySolver).routes, metadata: (solver as HighDensitySolver).nodeSolveMetadataById, queue: (solver as HighDensitySolver).unsolvedNodePortPoints }
    : { ...base, routes: (solver as GrowShrinkHighDensityIntraNodeSolver).solvedRoutes, scale: (solver as GrowShrinkHighDensityIntraNodeSolver).scaleFactor,
      growthAttempts: (solver as GrowShrinkHighDensityIntraNodeSolver).growthAttempts, winner: child((solver as GrowShrinkHighDensityIntraNodeSolver).winningSolver) }
}
const node: NodeWithPortPoints = { capacityMeshNodeId: "orchestration-crossing", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [
  { connectionName: "a", rootConnectionName: "a", x: -2, y: -1, z: 0, portPointId: "a1" },
  { connectionName: "a", rootConnectionName: "a", x: 2, y: 1, z: 0, portPointId: "a2" },
  { connectionName: "b", rootConnectionName: "b", x: -1, y: 2, z: 0, portPointId: "b1" },
  { connectionName: "b", rootConnectionName: "b", x: 1, y: -2, z: 0, portPointId: "b2" },
] }
let comparisons = 0
for (const mode of ["board", "board-growth", "growth"] as const) {
  const actualCache = new RecordingCache(), expectedCache = new RecordingCache()
  for (const fullSolve of [false, true]) {
    const actualNode = structuredClone(node), expectedNode = structuredClone(node)
    const actualNodes = [actualNode], expectedNodes = [expectedNode]
    install(actualCache)
    const actual: Solver = mode === "growth" ? new GrowShrinkHighDensityIntraNodeSolver({ nodeWithPortPoints: actualNode })
      : new HighDensitySolver({ nodePortPoints: actualNodes, useGrowShrinkHighDensityIntraNodeSolver: mode === "board-growth", nodePfById: new Map([[node.capacityMeshNodeId, 0.2]]) })
    install(expectedCache)
    const expected: Solver = mode === "growth" ? new ReferenceGrowth({ nodeWithPortPoints: expectedNode })
      : new ReferenceBoard({ nodePortPoints: expectedNodes, useGrowShrinkHighDensityIntraNodeSolver: mode === "board-growth", nodePfById: new Map([[node.capacityMeshNodeId, 0.2]]) })
    const stats = actual.stats
    const metadataEntries = new Map<string, unknown>()
    const compare = (label: string): void => {
      install(actualCache); const a = view(actual); const graphicsA = actual.visualize()
      install(expectedCache); const e = view(expected); const graphicsE = expected.visualize()
      assert.equal(json(a), json(e), `${mode}/${fullSolve}/${label}/state`)
      assert.equal(json(graphicsA), json(graphicsE), `${mode}/${fullSolve}/${label}/graphics`)
      assert.equal(json(actualCache.events), json(expectedCache.events), `${mode}/${fullSolve}/${label}/cache callbacks`)
      assert.equal(actual.stats, stats)
      if (actual instanceof HighDensitySolver) {
        assert.equal(actual.unsolvedNodePortPoints, actualNodes)
        for (const [id, entry] of actual.nodeSolveMetadataById) {
          assert.equal(entry.node, actualNode, "Metadata retains the input node")
          if (metadataEntries.has(id)) assert.equal(entry, metadataEntries.get(id), "Metadata record retains identity")
          metadataEntries.set(id, entry)
        }
      } else assert.equal(actual.nodeWithPortPoints, actualNode)
      comparisons++
    }
    compare("constructor")
    if (fullSolve) {
      install(actualCache); actual.solve()
      install(expectedCache); expected.solve()
      compare("full solve")
    } else {
      for (let iteration = 0; !expected.solved && !expected.failed; iteration++) {
        assert.ok(iteration < 2000, "Focused orchestration fixture exceeded step budget")
        install(actualCache); actual.step()
        install(expectedCache); expected.step()
        compare(`step ${iteration + 1}`)
      }
    }
    assert.ok(actual.solved || actual.failed)
    console.log(`${mode}/${fullSolve ? "full solve" : "step"}: exact orchestration state, routes, graphics and cache callbacks`)
  }
}
console.log(`${comparisons} orchestration comparisons passed`)

// A rejected solution must retain failed growth children for later visualization.
const failedActualCache = new RecordingCache(), failedExpectedCache = new RecordingCache()
const failedProps = { nodePortPoints: [structuredClone(node)], useGrowShrinkHighDensityIntraNodeSolver: true,
  growShrinkSolutionValidator: (): boolean => false, growShrinkMaxInnerIterationsPerGrowthAttempt: 10 }
install(failedActualCache)
const failedActual = new HighDensitySolver(failedProps)
install(failedExpectedCache)
const failedExpected = new ReferenceBoard({ ...failedProps, nodePortPoints: [structuredClone(node)] })
for (let step = 0; !failedExpected.solved && !failedExpected.failed; step++) {
  assert.ok(step < 2000, "Rejected-validator fixture exceeded step budget")
  install(failedActualCache); failedActual.step()
  install(failedExpectedCache); failedExpected.step()
  assert.equal(json(view(failedActual)), json(view(failedExpected)), `validator-reject/${step}/state`)
}
assert.equal(failedActual.failed, true)
assert.equal(failedActual.failedSolvers.length, failedExpected.failedSolvers.length)
install(failedActualCache); const failedGraphics = failedActual.visualize()
install(failedExpectedCache); const failedReferenceGraphics = failedExpected.visualize()
assert.equal(json(failedGraphics), json(failedReferenceGraphics), "Retained failed grow visualization")
console.log("Rejected validators retain failed grow children and exact failure visualization")

const pushedActualNodes: NodeWithPortPoints[] = [], pushedExpectedNodes: NodeWithPortPoints[] = []
const pushedActual = new HighDensitySolver({ nodePortPoints: pushedActualNodes })
const pushedExpected = new ReferenceBoard({ nodePortPoints: pushedExpectedNodes })
pushedActualNodes.push(structuredClone(node)); pushedExpectedNodes.push(structuredClone(node))
pushedActual.step(); pushedExpected.step()
assert.equal(pushedActualNodes.length, pushedExpectedNodes.length)
assert.equal(json(child(pushedActual.activeSubSolver)), json(child(pushedExpected.activeSubSolver)), "Input queue pushed through original alias before step")
console.log("Original input queue alias mutation is honored before factory creation")
