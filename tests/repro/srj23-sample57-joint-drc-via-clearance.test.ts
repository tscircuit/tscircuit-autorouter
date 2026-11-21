import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { createSrj23Sample57JointDrcRepairHarness } from "tests/fixtures/loadSrj23Sample57JointDrcRepairFixture"

test.failing(
  "srj23 sample 57 joint DRC repair keeps net 2's via clear of net 4",
  (): void => {
    const { jointRepairParams, convertNewRoutes, createSolver } =
      createSrj23Sample57JointDrcRepairHarness()
    const evaluate = createPipeline9AutoroutingDrcEvaluator({
      inputSrj: jointRepairParams.originalSrj,
      srjWithPointPairs: jointRepairParams.srjWithPointPairs,
    })
    const inputErrors = evaluate([
      ...convertNewRoutes(jointRepairParams.newHdRoutes),
      ...jointRepairParams.updatedPreloadedTraces,
    ]).errors.filter(
      (error) =>
        error.type === "pcb_via_trace_clearance_error" &&
        error.pcb_trace_id === "source_net_4_mst0_0",
    )
    expect(inputErrors).toHaveLength(0)

    const solver = createSolver()
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()

    const outputErrors = evaluate([
      ...convertNewRoutes(solver.getOutput()),
      ...solver.getUpdatedPreloadedTraces(),
    ]).errors.filter(
      (error) =>
        error.type === "pcb_via_trace_clearance_error" &&
        error.pcb_trace_id === "source_net_4_mst0_0",
    )
    expect(outputErrors).toHaveLength(0)
  },
)
