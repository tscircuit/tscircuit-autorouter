import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { executeGridHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeGridHistoryJob"
import { ReplayHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA01Solver"
import { ReplayHighDensityA03Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA03Solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("a speculative successful grid output exception is observed only by original onSolve", async (): Promise<void> => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "grid-output-exception", center: { x: 0, y: 0 },
    width: 3, height: 3, availableZ: [0, 1], portPoints: [
      { connectionName: "A", x: -1.2, y: 0, z: 0 }, { connectionName: "A", x: 1.2, y: 0, z: 0 },
    ] }
  for (const algorithm of ["a01", "a03"] as const) {
    const params = { nodeWithPortPoints: node, cellSizeMm: 0.1, viaDiameter: 0.3,
      highResolutionCellSize: 0.1, lowResolutionCellSize: 0.4, traceMargin: 0.1 }
    const replay = algorithm === "a01" ? new ReplayHighDensityA01Solver(params) : new ReplayHighDensityA03Solver(params)
    replay.setup()
    replay.MAX_ITERATIONS = Math.min(replay.MAX_ITERATIONS, 1_000)
    const job = replay.createHistoryJob(0)
    const prototype = algorithm === "a01" ? HighDensitySolverA01.prototype : HighDensitySolverA03.prototype
    const originalOutput = prototype.getOutput
    prototype.getOutput = function (): never { throw new TypeError("grid output controlled exception") }
    let history: ReturnType<typeof executeGridHistoryJob>
    try { history = executeGridHistoryJob(job) }
    finally { prototype.getOutput = originalOutput }
    expect(history.checkpoints.at(-1)?.solved).toBe(true)
    expect(history.outputException).toMatchObject({ name: "TypeError", message: "grid output controlled exception" })
    replay.setHistoryRequest(job, Promise.resolve(history))
    await replay.prepareForNextStep()
    while (!replay.solved && !replay.failed) replay.step()
    expect(replay.solved).toBe(true)
    expect(replay.failed).toBe(false)
    let caught: unknown
    try { replay.getOutput() } catch (error: unknown) { caught = error }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe("TypeError")
    expect((caught as Error).message).toBe("grid output controlled exception")
  }
})
