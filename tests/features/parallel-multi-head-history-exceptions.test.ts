import { expect, spyOn, test } from "bun:test"
import { executeMultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeMultiHeadHistoryJob"
import type { MultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import { ReplayMultiHeadPolyLineSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayMultiHeadPolyLineSolver"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("speculative candidate exceptions stay deferred until their original serial step", async (): Promise<void> => {
  const job: MultiHeadHistoryJob = { kind: "multiHeadHistory", candidateId: 0,
    params: { nodeWithPortPoints: createNetworkedNode({ nodeId: "deferred-error", connectionName: "signal" }),
      hyperParameters: { MULTI_HEAD_POLYLINE_SOLVER: true, SEGMENTS_PER_POLYLINE: 6, BOUNDARY_PADDING: 0.05 } },
    connectivityNetMap: {}, connectivityIdToNetMap: {} }
  const originalStep = MultiHeadPolyLineIntraNodeSolver3.prototype._step
  const expectedException = new RangeError("deliberate second-step candidate exception")
  const log = spyOn(console, "error").mockReturnValue(undefined)
  const step = spyOn(MultiHeadPolyLineIntraNodeSolver3.prototype, "_step").mockImplementation(function (this: MultiHeadPolyLineIntraNodeSolver3): void {
    if (this.iterations === 2) {
      throw expectedException
    }
    originalStep.call(this)
  })
  try {
    const history = executeMultiHeadHistoryJob(job)
    expect(history.steps).toHaveLength(2)
    expect(history.steps[0]!.exception).toBeUndefined()
    expect(history.steps[1]).toMatchObject({ iterations: 2, failed: true,
      exception: { name: "RangeError", message: expectedException.message } })
    step.mockRestore()
    const replay = new ReplayMultiHeadPolyLineSolver(job.params)
    replay.setHistoryRequest(Promise.resolve(history))
    await replay.prepareForNextStep()
    expect(replay.failed).toBe(false)
    expect(replay.error).toBeNull()
    expect(replay.iterations).toBe(0)
    expect(() => replay.step()).not.toThrow()
    expect(replay.failed).toBe(false)
    expect(replay.error).toBeNull()
    let thrown: unknown
    try {
      replay.step()
    } catch (error: unknown) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({ name: "RangeError", message: expectedException.message })
    expect(replay.failed).toBe(true)
    expect(replay.iterations).toBe(2)
    expect(replay.error).toBe(history.steps[1]!.error)
    expect(log).toHaveBeenCalledTimes(2)
  } finally {
    step.mockRestore()
    log.mockRestore()
  }
})
