import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { executeGridHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeGridHistoryJob"
import { ReplayHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA01Solver"
import { ReplayHighDensityA03Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA03Solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("grid-history exceptions remain deferred until the original selected native substep", async (): Promise<void> => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "grid-exception", center: { x: 0, y: 0 },
    width: 8, height: 8, availableZ: [0, 1], portPoints: [
      { connectionName: "A", x: -3.5, y: -3.5, z: 0 },
      { connectionName: "A", x: 3.5, y: 3.5, z: 0 },
    ] }
  for (const algorithm of ["a01", "a03"] as const) {
    const params = { nodeWithPortPoints: node, cellSizeMm: 0.1, viaDiameter: 0.3,
      highResolutionCellSize: 0.1, lowResolutionCellSize: 0.4, traceMargin: 0.1 }
    const replay = algorithm === "a01" ? new ReplayHighDensityA01Solver(params) : new ReplayHighDensityA03Solver(params)
    replay.setup()
    replay.MAX_ITERATIONS = Math.min(replay.MAX_ITERATIONS, 1_000)
    const job = replay.createHistoryJob(0)
    const prototype = algorithm === "a01" ? HighDensitySolverA01.prototype : HighDensitySolverA03.prototype
    const originalStep = prototype._step
    const originalOutput = prototype.getOutput
    prototype._step = function (): void {
      if (this.iterations === 43) throw new RangeError("grid history controlled exception")
      originalStep.call(this)
    }
    prototype.getOutput = function (): ReturnType<typeof originalOutput> {
      if (this.failed) throw new Error("Native output must not be read after a failed grid step")
      return originalOutput.call(this)
    }
    let history: ReturnType<typeof executeGridHistoryJob>
    try { history = executeGridHistoryJob(job) }
    finally { prototype._step = originalStep; prototype.getOutput = originalOutput }
    expect(history.checkpoints).toHaveLength(1)
    expect(history.output).toEqual([])
    expect(history.checkpoints[0]).toMatchObject({ iterations: 43, failed: true,
      exception: { name: "RangeError", message: "grid history controlled exception" } })
    replay.setHistoryRequest(job, Promise.resolve(history))
    await replay.prepareForNextStep()
    for (let i = 0; i < 42; i++) replay.step()
    expect(replay.failed).toBe(false)
    expect(replay.iterations).toBe(42)
    let caught: unknown
    try { replay.step() } catch (error: unknown) { caught = error }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe("RangeError")
    expect((caught as Error).message).toBe("grid history controlled exception")
    expect(replay.iterations).toBe(43)
    expect(replay.failed).toBe(true)
    expect(replay.error).toBe(history.checkpoints[0]!.error)
    expect(replay.MAX_ITERATIONS).toBe(job.maxIterations)
  }
})
