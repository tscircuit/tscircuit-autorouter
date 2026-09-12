import assert from "node:assert/strict"
import { importReference } from "./tsReference"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "../../../lib/solvers/HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
import { SingleTransitionIntraNodeSolver } from "../../../lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "../../../lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { TwoCrossingRoutesHighDensitySolver } from "../../../lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"
import { SingleTransitionCrossingRouteSolver } from "../../../lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { MultiHeadPolyLineIntraNodeSolver } from "../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import { MultiHeadPolyLineIntraNodeSolver3 } from "../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { ViaPossibilitiesSolver2 } from "../../../lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2"
import type { SpecializedIntraNodeSolverAdapter } from "../../../lib/bindings/high-density/SpecializedIntraNodeSolverAdapter"

type Diagnostic = Record<string, unknown> & { step(): void; visualize(): unknown; solved: boolean; failed: boolean }
type Props = ConstructorParameters<typeof MultiHeadPolyLineIntraNodeSolver>[0]
const fixtures = [
  [SingleLayerNoDifferentRootIntersectionsIntraNodeSolver, "HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"],
  [SingleTransitionIntraNodeSolver, "HighDensitySolver/SingleTransitionIntraNodeSolver"],
  [SingleTransitionThroughObstacleIntraNodeSolver, "HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"],
  [TwoCrossingRoutesHighDensitySolver, "HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"],
  [SingleTransitionCrossingRouteSolver, "HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"],
  [MultiHeadPolyLineIntraNodeSolver, "HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"],
  [MultiHeadPolyLineIntraNodeSolver2, "HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"],
  [MultiHeadPolyLineIntraNodeSolver3, "HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"],
  [ViaPossibilitiesSolver2, "ViaPossibilitiesSolver/ViaPossibilitiesSolver2"],
] as const
function bytes(value: unknown): string { return JSON.stringify(value, (_key, item: unknown): unknown => item instanceof Map ? Object.fromEntries(item) : item) }
let comparisons = 0
for (const [Solver, path] of fixtures) {
  const reference = await importReference<Record<string, new (props: Props) => Diagnostic>>(`lib/solvers/${path}.ts`)
  for (const transition of [false, true]) {
    const props: Props = { nodeWithPortPoints: { capacityMeshNodeId: "facade", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [
      { x: -2, y: -1, z: 0, connectionName: "a", rootConnectionName: "a", portPointId: "a1" },
      { x: 2, y: 1, z: transition ? 1 : 0, connectionName: "a", rootConnectionName: "a", portPointId: "a2" },
      { x: -1, y: 2, z: 0, connectionName: "b", rootConnectionName: "b", portPointId: "b1" },
      { x: 1, y: -2, z: 0, connectionName: "b", rootConnectionName: "b", portPointId: "b2" },
    ] }, colorMap: { a: "red", b: "blue" } }
    const actualProps = structuredClone(props)
    const actual = new Solver(actualProps) as SpecializedIntraNodeSolverAdapter
    const expected = new reference[Solver.name]!(structuredClone(props))
    const diagnostic = actual as unknown as Diagnostic
    const retained = new Map<string, unknown>()
    try {
      if (actual instanceof MultiHeadPolyLineIntraNodeSolver3) assert.ok(actual instanceof MultiHeadPolyLineIntraNodeSolver2 && actual instanceof MultiHeadPolyLineIntraNodeSolver)
      for (let step = 0; step <= 8; step++) {
        for (const field of [...Solver.diagnosticFields, "iterations", "failed", "solved", "error", "progress", "MAX_ITERATIONS"]) {
          assert.deepEqual(diagnostic[field], expected[field], `${Solver.name}/${transition}/${step}/${field}`)
          comparisons++
          if (field === "solvedRoutes") {
            if (retained.has(field)) assert.equal(diagnostic[field], retained.get(field), "Retained route array")
            retained.set(field, diagnostic[field])
          }
        }
        assert.equal(bytes(actual.visualize()), bytes(expected.visualize()), `${Solver.name}/${transition}/${step}/graphics`)
        if (expected.solved || expected.failed || step === 8) break
        actual.step(); expected.step()
      }
      if (actual instanceof ViaPossibilitiesSolver2) {
        assert.ok(actual.portPairMap instanceof Map && actual.completedPaths instanceof Map && actual.placeholderPaths instanceof Map)
        for (const [name, pair] of actual.portPairMap) {
          const matching = actualProps.nodeWithPortPoints.portPoints.filter(point => point.connectionName === name)
          assert.equal(pair.start, matching[0])
          assert.equal(pair.end, matching[matching.length - 1])
        }
        assert.equal(actual.availableZ, actualProps.nodeWithPortPoints.availableZ)
        const expectedVia = expected as unknown as ViaPossibilitiesSolver2
        const headIndex = expectedVia.currentPath.indexOf(expectedVia.currentHead)
        assert.ok(headIndex >= 0)
        assert.equal(actual.currentHead, actual.currentPath[headIndex])
        if (actual.solved) assert.equal(actual.completedPaths.get(actual.currentConnectionName), actual.currentPath)
        const point = { x: 0.25, y: -0.75, z: 0 }
        assert.deepEqual(actual._padByNewHeadWallBuffer(point), expectedVia._padByNewHeadWallBuffer(point))
        assert.deepEqual(actual._padByPlaceholderWallBuffer(point), expectedVia._padByPlaceholderWallBuffer(point))
      }
      if (actual instanceof MultiHeadPolyLineIntraNodeSolver && actual.lastCandidate) {
        const referenceMulti = expected as unknown as MultiHeadPolyLineIntraNodeSolver
        const candidate = actual.lastCandidate
        assert.equal(actual.computeG(candidate.polyLines, candidate), referenceMulti.computeG(referenceMulti.lastCandidate!.polyLines, referenceMulti.lastCandidate!))
        assert.equal(actual.computeH(candidate), referenceMulti.computeH(referenceMulti.lastCandidate!))
        assert.deepEqual(actual.computeMinGapBtwPolyLines(candidate.polyLines), referenceMulti.computeMinGapBtwPolyLines(referenceMulti.lastCandidate!.polyLines))
        if (actual instanceof MultiHeadPolyLineIntraNodeSolver2) {
          const input = structuredClone(candidate.polyLines), refInput = structuredClone(referenceMulti.lastCandidate!.polyLines)
          assert.deepEqual(actual.applyForcesToPolyLines(input), (referenceMulti as MultiHeadPolyLineIntraNodeSolver2).applyForcesToPolyLines(refInput))
          assert.deepEqual(input, refInput, "Public force method mutates arguments exactly")
        }
      }
      if (actual instanceof TwoCrossingRoutesHighDensitySolver || actual instanceof SingleTransitionCrossingRouteSolver) assert.equal(actual.getSolvedRoutes(), actual.solvedRoutes)
      console.log(`${Solver.name}/${transition}: facade state, maps, routes and graphics identical`)
    } finally { actual.dispose() }
  }
}
console.log(`${comparisons} facade comparisons passed`)
