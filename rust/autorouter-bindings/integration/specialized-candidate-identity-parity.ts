import assert from "node:assert/strict"
import { MultiHeadPolyLineIntraNodeSolver } from "../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import { MultiHeadPolyLineIntraNodeSolver3 } from "../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { importReference } from "./tsReference"

type Props = ConstructorParameters<typeof MultiHeadPolyLineIntraNodeSolver>[0]
const props: Props = { nodeWithPortPoints: { capacityMeshNodeId: "identity", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [
  { x: -2, y: -1, z: 0, connectionName: "a" }, { x: 2, y: 1, z: 0, connectionName: "a" },
  { x: -1, y: 2, z: 0, connectionName: "b" }, { x: 1, y: -2, z: 0, connectionName: "b" },
] }, colorMap: { a: "red", b: "blue" } }
const cases = [
  [MultiHeadPolyLineIntraNodeSolver, "MultiHeadPolyLineIntraNodeSolver"],
  [MultiHeadPolyLineIntraNodeSolver2, "MultiHeadPolyLineIntraNodeSolver2_Optimized"],
  [MultiHeadPolyLineIntraNodeSolver3, "MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"],
] as const
let assertions = 0
for (const [Solver, file] of cases) {
  const reference = await importReference<Record<string, typeof MultiHeadPolyLineIntraNodeSolver>>(`lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/${file}.ts`)
  const actual = new Solver(structuredClone(props))
  const expected = new reference[Solver.name]!(structuredClone(props))
  try {
    actual.step(); expected.step()
    assert.ok(actual.candidates.length)
    const queue = actual.candidates
    for (let iteration = 0; iteration < 5 && !expected.solved && !expected.failed; iteration++) {
      const candidate = actual.candidates[0]!, referenceCandidate = expected.candidates[0]!
      const lines = candidate.polyLines, line = lines[0]!, points = line.mPoints, point = points[0]!
      const gaps = candidate.minGaps, referenceGaps = referenceCandidate.minGaps
      actual.step(); expected.step()
      assert.equal(actual.candidates, queue, "Queue array identity survives native snapshots")
      assert.equal(actual.lastCandidate, candidate, "The shifted candidate remains lastCandidate")
      assert.equal(actual.lastCandidate!.polyLines, lines)
      assert.equal(actual.lastCandidate!.polyLines[0], line)
      assert.equal(actual.lastCandidate!.polyLines[0]!.mPoints, points)
      assert.equal(actual.lastCandidate!.polyLines[0]!.mPoints[0], point)
      assert.equal(actual.lastCandidate!.minGaps === gaps, expected.lastCandidate!.minGaps === referenceGaps)
      assert.deepEqual(candidate, referenceCandidate, "Retained candidate observes native mutations")
      assert.deepEqual(actual.candidates, expected.candidates)
      assert.equal(actual.candidates.indexOf(candidate), expected.candidates.indexOf(referenceCandidate))
      if (actual.candidates.includes(candidate)) {
        candidate.g += 0.125; referenceCandidate.g += 0.125
        actual.pushObservedDiagnostics(); actual.syncObservedDiagnostics()
        assert.equal(actual.lastCandidate!.g, referenceCandidate.g)
        assert.equal(actual.candidates[actual.candidates.indexOf(candidate)], actual.lastCandidate)
      }
      assertions += 12
    }
    console.log(`${Solver.name}: retained candidate and nested identities match reference`)
  } finally { actual.dispose() }
}
const actual = new MultiHeadPolyLineIntraNodeSolver(structuredClone(props))
const { MultiHeadPolyLineIntraNodeSolver: Reference } = await importReference<{ MultiHeadPolyLineIntraNodeSolver: typeof MultiHeadPolyLineIntraNodeSolver }>("lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver.ts")
const expected = new Reference(structuredClone(props))
try {
  actual.step(); expected.step()
  const candidate = actual.candidates[0]!, refCandidate = expected.candidates[0]!
  const neighbors = actual.getNeighbors(candidate), refNeighbors = expected.getNeighbors(refCandidate)
  assert.deepEqual(neighbors, refNeighbors)
  for (const neighbor of neighbors) {
    assert.notEqual(neighbor.polyLines, candidate.polyLines)
    for (let i = 0; i < neighbor.polyLines.length; i++) {
      assert.notEqual(neighbor.polyLines[i], candidate.polyLines[i])
      assert.equal(neighbor.polyLines[i]!.start, candidate.polyLines[i]!.start)
      assert.equal(neighbor.polyLines[i]!.end, candidate.polyLines[i]!.end)
      assert.notEqual(neighbor.polyLines[i]!.mPoints[0], candidate.polyLines[i]!.mPoints[0])
    }
    actual.insertCandidate(neighbor)
    assert.ok(actual.candidates.includes(neighbor), "insertCandidate retains the supplied object")
  }
  const duplicate = structuredClone(candidate)
  actual.insertCandidate(duplicate)
  assert.ok(actual.candidates.includes(duplicate))
  assert.notEqual(duplicate, candidate, "Structurally equal candidates remain distinct")
  actual.insertCandidate(candidate)
  assert.equal(actual.candidates.filter(entry => entry === candidate).length, 2, "Repeated insertion preserves the exact shared object")
  console.log(`Public neighbor/insert identity cases passed; ${assertions} step identity assertions passed`)
} finally { actual.dispose() }
