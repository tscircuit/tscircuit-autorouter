import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createPipeline9JointFinalReferenceFixture } from "../fixtures/pipeline9-joint-final-reference-fixture"

test("optional final acceptance preserves the disabled control and surfaces evaluator and solver errors", (): void => {
  const { params } = createPipeline9JointFinalReferenceFixture()
  const control = new Pipeline9JointDrcRepairSolver({
    ...params,
    finalReferenceDrcEvaluator: undefined,
  })
  expect(control.stats.finalReferenceAcceptanceChecked).toBeUndefined()
  const source = structuredClone(params.newHdRoutes)
  expect((): void => {
    new Pipeline9JointDrcRepairSolver({
      ...params,
      finalReferenceDrcEvaluator: (): never => {
        throw new Error("reference evaluator failed")
      },
    })
  }).toThrow("reference evaluator failed")
  const solver = new Pipeline9JointDrcRepairSolver(params)
  const access = solver as unknown as {
    solved: boolean
    exactRepairSolver: {
      failed: boolean
      solved: boolean
      error: string
      progress: number
      step(): void
    }
  }
  access.solved = false
  access.exactRepairSolver = {
    failed: false,
    solved: false,
    error: "portfolio failed",
    progress: 0,
    step(): void {
      this.failed = true
    },
  }
  solver.step()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe("portfolio failed")
  expect(solver.stats.rejectedOptimizationCandidate).toBe(false)
  expect(params.newHdRoutes).toEqual(source)
})
