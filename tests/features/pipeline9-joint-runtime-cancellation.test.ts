import { expect, spyOn, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createJointRepairRuntimeFixture } from "../fixtures/createJointRepairRuntimeFixture"

test("a cancelled repair tail exits before constructing its numerical solvers", (): void => {
  const solver = createJointRepairRuntimeFixture()
  const cancellation = new Int32Array(new SharedArrayBuffer(4))
  Atomics.store(cancellation, 0, 1)
  const steps = spyOn(Pipeline9JointDrcRepairSolver.prototype, "step")
  try {
    expect(
      Pipeline9JointDrcRepairSolver.solveSpeculativeTail(
        solver.params,
        cancellation,
      ),
    ).toEqual({ type: "cancelled" })
    expect(steps).not.toHaveBeenCalled()
  } finally {
    steps.mockRestore()
  }
})
