import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { executeGridHistoryJob, snapshotNativeGridHistory, type NativeGridHistorySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeGridHistoryJob"
import { ReplayHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA01Solver"
import { ReplayHighDensityA03Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA03Solver"
import type { GridHistoryJob, GridHistorySnapshot } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const crossing: NodeWithPortPoints = {
  capacityMeshNodeId: "grid-history-quantum-crossing", center: { x: 0, y: 0 },
  width: 6, height: 6, availableZ: [0, 3], portPoints: [
    { connectionName: "A", rootConnectionName: "root_A", pcb_port_id: "a_start", x: -2.5, y: -2.5, z: 0 },
    { connectionName: "A", rootConnectionName: "root_A", pcb_port_id: "a_end", x: 2.5, y: 2.5, z: 0 },
    { connectionName: "B", rootConnectionName: "root_B", pcb_port_id: "b_start", x: -2.5, y: 2.5, z: 0 },
    { connectionName: "B", rootConnectionName: "root_B", pcb_port_id: "b_end", x: 2.5, y: -2.5, z: 0 },
  ],
}

function readReplayObservation(solver: ReplayHighDensityA01Solver | ReplayHighDensityA03Solver): GridHistorySnapshot {
  const observation = snapshotNativeGridHistory(solver)
  return { ...observation,
    solvedSegmentCount: solver.getReplaySolvedSegmentCount() ?? observation.solvedSegmentCount }
}

test("A01/A03 histories preserve native quantum observations, started prefixes, caps and fresh terminal outputs", async (): Promise<void> => {
  let observedSolved = false
  let observedFailed = false
  let observedStartedPrefix = false
  for (const algorithm of ["a01", "a03"] as const) {
    for (const cap of [101, 40_000]) {
      for (const prefix of [0, 100]) {
        const common = { nodeWithPortPoints: structuredClone(crossing), viaDiameter: 0.3,
          viaMinDistFromBorder: 0.15, traceThickness: 0.1, traceMargin: 0.1,
          effort: 1, hyperParameters: { shuffleSeed: 0 } }
        const params = algorithm === "a01" ? { ...common, cellSizeMm: 0.1 }
          : { ...common, highResolutionCellSize: 0.1, highResolutionCellThickness: 8, lowResolutionCellSize: 0.4 }
        const native: NativeGridHistorySolver = algorithm === "a01"
          ? new HighDensitySolverA01(params as ConstructorParameters<typeof HighDensitySolverA01>[0])
          : new HighDensitySolverA03(params)
        const replay = algorithm === "a01"
          ? new ReplayHighDensityA01Solver(params as ConstructorParameters<typeof HighDensitySolverA01>[0])
          : new ReplayHighDensityA03Solver(params)
        native.setup()
        replay.setup()
        native.MAX_ITERATIONS = Math.min(native.MAX_ITERATIONS, cap)
        replay.MAX_ITERATIONS = native.MAX_ITERATIONS
        let job: GridHistoryJob = replay.createHistoryJob(0)
        const originalParams = structuredClone(job.params)
        const history = executeGridHistoryJob(job)
        expect(job.params).toEqual(originalParams)
        expect(history.checkpoints.length).toBeLessThanOrEqual(Math.ceil(native.MAX_ITERATIONS / 100))
        for (let i = 0; i < prefix; i++) { native.step(); replay.step() }
        expect(native.solved || native.failed).toBe(false)
        if (prefix > 0) observedStartedPrefix = true
        job = replay.createHistoryJob(0)
        replay.setHistoryRequest(job, Promise.resolve(history))
        await replay.prepareForNextStep()
        expect(readReplayObservation(replay)).toEqual(snapshotNativeGridHistory(native))
        while (!native.solved && !native.failed) {
          for (let i = 0; i < 100; i++) { native.step(); replay.step() }
          expect(readReplayObservation(replay)).toEqual(snapshotNativeGridHistory(native))
        }
        if (native.solved) {
          expect(replay.getOutput()).toEqual(native.getOutput())
          expect(history.output).toEqual(native.getOutput())
          const firstOutput = replay.getOutput()
          const secondOutput = replay.getOutput()
          expect(firstOutput).not.toBe(secondOutput)
          if (firstOutput[0]?.route[0]) {
            firstOutput[0].route[0].x += 100
            expect(replay.getOutput()).toEqual(secondOutput)
            expect(history.output).toEqual(secondOutput)
          }
        } else {
          expect(history.output).toEqual([])
          expect(() => replay.getOutput()).toThrow("successful native onSolve boundary")
        }
        const terminal = readReplayObservation(replay)
        replay.step()
        expect(readReplayObservation(replay)).toEqual(terminal)
        observedSolved ||= native.solved
        observedFailed ||= native.failed
      }
    }
  }
  expect(observedSolved).toBe(true)
  expect(observedFailed).toBe(true)
  expect(observedStartedPrefix).toBe(true)
})
