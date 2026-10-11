import { expect, spyOn, test } from "bun:test"
import { HighDensityForceImproveSolver as OriginalSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import fixture from "high-density-repair01/tests/fixtures/gameboy-force-improve-platform.json"
import { HighDensityForceImproveSolver as WorkerSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/force-improvement-fork/HighDensityForceImproveSolver"
import { executeParallelStageJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerJobs"

type Params = ConstructorParameters<typeof OriginalSolver>[0]

test("force-improvement node workers select diagnostic-free execution and preserve original output", (): void => {
  const params = fixture as Params
  const original = new OriginalSolver(structuredClone(params))
  original.solve()
  const originalStep = WorkerSolver.prototype._step
  const captures: boolean[] = []
  const workerStep = spyOn(WorkerSolver.prototype, "_step").mockImplementation(function (this: WorkerSolver): void {
    captures.push(this.captureDiagnostics)
    originalStep.call(this)
    expect(this.latestVisualization).toEqual({})
    expect(this.failed).toBe(false)
  })
  try {
    const result = executeParallelStageJob({
      kind: "forceImproveNode", nodeWithPortPoints: structuredClone(params.nodeWithPortPoints[0]!),
      hdRoutes: structuredClone(params.hdRoutes), totalStepsPerNode: params.totalStepsPerNode!,
      nodeAssignmentMargin: params.nodeAssignmentMargin!,
    })
    expect(captures).toEqual([false])
    expect(result.kind).toBe("forceImproveNode")
    if (result.kind !== "forceImproveNode") throw new Error("Unexpected force worker result kind")
    expect(result.routes).toEqual(original.getOutput())
  } finally {
    workerStep.mockRestore()
  }
})
