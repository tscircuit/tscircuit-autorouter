import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateJointOriginalViaPlacement, makeJointOriginalViaPlacementFixture } from "./fixtures/pipeline9JointOriginalViaPlacement"

test("joint repair includes an original-board via finding absent from relaxed trace checks", (): void => {
  const fixture = makeJointOriginalViaPlacementFixture("board")
  const originalRoutes = structuredClone(fixture.params.newHdRoutes)
  const originalSrj = structuredClone(fixture.originalSrj)
  const initial = evaluateJointOriginalViaPlacement(fixture, originalRoutes)
  expect(initial.reference.errors).toEqual([])
  expect(initial.board.length).toBe(1)
  const solver = new Pipeline9JointDrcRepairSolver({ ...fixture.params, checkOriginalViaPlacement: true })
  expect(solver.stats.initialJointDrcIssueCount).toBe(1)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  const checked = evaluateJointOriginalViaPlacement(fixture, output)
  expect(checked.reference.errors).toEqual([])
  expect(checked.board).toEqual([])
  expect(checked.pad).toEqual([])
  expect(output).toHaveLength(1)
  expect(output[0]!.connectionName).toBe("signal")
  expect(output[0]!.route[0]).toMatchObject({ x: -1, y: 0.07, z: 1 })
  expect(output[0]!.route.at(-1)).toMatchObject({ x: 1, y: 0.07, z: 2 })
  expect(fixture.params.newHdRoutes).toEqual(originalRoutes)
  expect(fixture.originalSrj).toEqual(originalSrj)
})
