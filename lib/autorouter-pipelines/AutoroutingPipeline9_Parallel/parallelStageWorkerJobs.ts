import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { HighDensityRepairSolver } from "high-density-repair02"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { ParallelStageWorkerJob, ParallelStageWorkerResult } from "./parallelStageWorkerTypes"

/** Both existing repair stages own disjoint route sets and use immutable inputs. */
export function executeParallelStageJob(
  job: ParallelStageWorkerJob,
): ParallelStageWorkerResult {
  switch (job.kind) {
    case "forceImproveNode": {
      const solver = new HighDensityForceImproveSolver({
        nodeWithPortPoints: [job.nodeWithPortPoints],
        hdRoutes: job.hdRoutes,
        totalStepsPerNode: job.totalStepsPerNode,
        nodeAssignmentMargin: job.nodeAssignmentMargin,
      })
      solver.solve()
      if (solver.failed || !solver.solved) {
        throw new Error(`Parallel force improvement failed: ${solver.error}`)
      }
      return { kind: job.kind, routes: solver.getOutput() }
    }
    case "repairNode": {
      const solver = new HighDensityRepairSolver({
        repairBoundaryDiagonals: false,
        sample: job.sample,
        margin: job.margin,
      })
      solver.solve()
      if (solver.failed || !solver.solved) {
        throw new Error(`Parallel high density repair failed: ${solver.error}`)
      }
      return {
        kind: job.kind,
        repairedRoutes: solver.getOutput().repairedRoutes,
        stats: solver.stats,
      }
    }
    case "simplifyPathComponent": {
      const solver = new MultiSimplifiedPathSolver({
        ...job.params,
        connMap: new ConnectivityMap(job.connectivityNetMap),
      })
      solver.solve()
      if (solver.failed || !solver.solved) {
        throw new Error(`Parallel path simplification failed: ${solver.error}`)
      }
      return { kind: job.kind, routes: solver.simplifiedHdRoutes }
    }
  }
}
