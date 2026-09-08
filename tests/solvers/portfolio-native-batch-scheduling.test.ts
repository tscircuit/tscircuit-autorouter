import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { HyperParameterSupervisorSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("native batches preserve portfolio scheduling and observable search boundaries", () => {
  let batchedSteps = 0
  for (const layers of [2, 6]) {
    for (const quantum of [1, 7, 100]) {
      const nodeWithPortPoints: NodeWithPortPoints = {
        capacityMeshNodeId: "native-batch-scheduling",
        center: { x: 0, y: 0 }, width: 2, height: 2,
        availableZ: Array.from({ length: layers }, (_, z) => z),
        portPoints: [
          { connectionName: "a", x: -.8, y: -.6, z: 0 },
          { connectionName: "a", x: .8, y: .6, z: layers - 1 },
          { connectionName: "b", x: -.8, y: .6, z: 0 },
          { connectionName: "b", x: .8, y: -.6, z: 0 },
        ],
      }
      const supervisors = [false, true].map(() => new PortfolioSingleIntraNodeSolver({
        nodeWithPortPoints: structuredClone(nodeWithPortPoints), obstacles: [], layerCount: layers,
      }))
      const candidates = [false, true].map(() => {
        const solver = new HighDensitySolverA01({
          nodeWithPortPoints: structuredClone(nodeWithPortPoints), useNativeSearch: true,
          cellSizeMm: .05, traceMargin: .15, traceThickness: .1,
          viaDiameter: .3, viaMinDistFromBorder: .15,
          hyperParameters: { greedyMultiplier: 0 },
        })
        solver.MAX_ITERATIONS = 5000
        return { solver, hyperParameters: {}, g: 0, h: 0, f: 0 }
      })
      for (const supervisor of supervisors) supervisor.MIN_SUBSTEPS = quantum
      for (let turn = 0; !candidates[0]!.solver.solved && !candidates[0]!.solver.failed; turn++) {
        for (let mode = 0; mode < 2; mode++) {
          const prototype = mode === 0
            ? HyperParameterSupervisorSolver.prototype
            : PortfolioSingleIntraNodeSolver.prototype
          ;(prototype as any).stepSupervisedSolver.call(supervisors[mode], candidates[mode])
        }
        const snapshot = (solver: HighDensitySolverA01): unknown => ({
          iterations: solver.iterations, solved: solver.solved, failed: solver.failed,
          error: solver.error, progress: solver.progress, output: solver.getOutput(),
          searchIterations: (solver as any).searchIterations,
          totalRips: (solver as any).totalRipEvents,
          ripCount: (solver as any).ripCount.slice(),
          openSetSize: solver.openSet.length,
          activeConnection: (solver as any).activeConnection,
          nativeSteps: solver.nativeSearchSteps,
        })
        expect(snapshot(candidates[1]!.solver)).toEqual(snapshot(candidates[0]!.solver))
        // A live scheduling change takes effect at the same next boundary.
        if (turn === 3) for (const supervisor of supervisors) supervisor.MIN_SUBSTEPS = quantum + 2
      }
      batchedSteps += candidates[1]!.solver.nativeSearchBatchedSteps
      expect(candidates[1]!.solver.nativeSearchSteps).toBeGreaterThan(100)
      expect(candidates[0]!.solver.nativeSearchBatchedSteps).toBe(0)
      expect(candidates[1]!.solver.visualize()).toEqual(candidates[0]!.solver.visualize())
    }
  }
  expect(batchedSteps).toBeGreaterThan(0)
})
