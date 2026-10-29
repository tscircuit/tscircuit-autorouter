import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateJointOriginalViaPlacement, makeJointOriginalViaPlacementFixture } from "./fixtures/pipeline9JointOriginalViaPlacement"

test("joint repair clears a foreign surface pad crossed by the full manufactured via span", (): void => {
  const fixture = makeJointOriginalViaPlacementFixture("foreign-pad")
  const originalRoutes = structuredClone(fixture.params.newHdRoutes)
  const initial = evaluateJointOriginalViaPlacement(fixture, originalRoutes)
  expect(initial.reference.errors).toEqual([])
  expect(initial.board).toEqual([])
  expect(initial.pad).toHaveLength(1)
  expect(initial.pad[0]!.pcb_pad_ids).toEqual(["via_0", "original_pad_with_under_scores"])
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
  expect(output[0]!.route[0]).toMatchObject({ x: -1, y: 0, z: 1 })
  expect(output[0]!.route.at(-1)).toMatchObject({ x: 1, y: 0, z: 2 })
  expect(fixture.params.newHdRoutes).toEqual(originalRoutes)
})
