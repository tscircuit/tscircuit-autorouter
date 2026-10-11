import { HighDensityForceImproveSolver } from "./force-improvement-fork/HighDensityForceImproveSolver"
import { HighDensityRepairSolver } from "high-density-repair02"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { preserveLeadingPathLayerTransitions } from "./preserveLeadingPathLayerTransitions"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"
import { getPipeline9RegionalB01CandidateOutput, preparePipeline9RegionalB01Candidate } from "../AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { Pipeline9RegionalFallbackSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { ParallelForceImproveNodeJob, ParallelForceImproveNodeResult, ParallelIndexedNodeResult, ParallelRepairNodeJob, ParallelRepairNodeResult, ParallelRegionalB01CandidateResult, ParallelRegionalFallbackResult, ParallelStageWorkerJob, ParallelStageWorkerResult } from "./parallelStageWorkerTypes"
import { assertParallelNodeBatchJob } from "./parallelNodeJobBatching"
import { computeTinyLandmarkDistances } from "./TinyLandmarkHeuristic"
import { executeNegotiatedPathingRouteJob } from "./TinyNegotiatedRouteSearch"
import { executeParallelGoalBallJob } from "./parallelGoalBallWorkerJobs"
import { ParallelPathWaveExecutor } from "./executeParallelPathWave"
import { executeParallelGlobalDrcTrial } from "./executeParallelGlobalDrcTrial"

const pathWaveExecutor = new ParallelPathWaveExecutor()

function executeForceImproveNode(job: ParallelForceImproveNodeJob): ParallelForceImproveNodeResult {
  const solver = new HighDensityForceImproveSolver({
    nodeWithPortPoints: [job.nodeWithPortPoints],
    hdRoutes: job.hdRoutes,
    totalStepsPerNode: job.totalStepsPerNode,
    nodeAssignmentMargin: job.nodeAssignmentMargin,
    captureDiagnostics: false,
  })
  solver.solve()
  if (solver.failed || !solver.solved) {
    throw new Error(`Parallel force improvement failed: ${solver.error}`)
  }
  return { kind: job.kind, routes: solver.getOutput() }
}

function executeRepairNode(job: ParallelRepairNodeJob): ParallelRepairNodeResult {
  const solver = new HighDensityRepairSolver({
    repairBoundaryDiagonals: false,
    sample: job.sample,
    margin: job.margin,
  })
  solver.solve()
  if (solver.failed || !solver.solved) {
    throw new Error(`Parallel high density repair failed: ${solver.error}`)
  }
  return { kind: job.kind, repairedRoutes: solver.getOutput().repairedRoutes, stats: solver.stats }
}

function executeRegionalFallback(
  job: Extract<ParallelStageWorkerJob, { kind: "regionalFallbackSolve" }>,
): ParallelRegionalFallbackResult {
  try {
    const solver = new Pipeline9RegionalFallbackSolver({
      ...job.params, connMap: restoreWorkerConnectivityMap(job),
    })
    const childStepBudget = Math.floor(solver.MAX_ITERATIONS) + 1
    if (!Number.isSafeInteger(childStepBudget) || childStepBudget < 1) {
      throw new Error("Regional B01 child has an invalid iteration limit")
    }
    solver.solve()
    return { kind: job.kind, status: "prepared", childStepBudget,
      solved: solver.solved, failed: solver.failed,
      routes: solver.solved && !solver.failed ? solver.getOutput() : undefined }
  } catch (error: unknown) {
    return { kind: job.kind, status: "error", error: error instanceof Error ? error.message : String(error) }
  }
}

function executeRegionalB01Candidate(
  job: Extract<ParallelStageWorkerJob, { kind: "regionalB01Candidate" }>,
): ParallelRegionalB01CandidateResult {
  try {
    const problem = preparePipeline9RegionalB01Candidate({
      ...job.params,
      connMap: restoreWorkerConnectivityMap(job),
    })
    if (!problem) return { kind: job.kind, status: "skipped", usedFallback: false, childStepBudget: 0 }
    const childStepBudget = Math.floor(problem.solver.MAX_ITERATIONS) + 1
    if (!Number.isSafeInteger(childStepBudget) || childStepBudget < 1) {
      throw new Error("Regional B01 child has an invalid iteration limit")
    }
    problem.solver.solve()
    const output = getPipeline9RegionalB01CandidateOutput(problem)
    return { kind: job.kind, status: "prepared", childStepBudget,
      replacement: output?.routes[job.params.routeIndex], usedFallback: output?.usedFallback ?? false }
  } catch (error: unknown) {
    // Speculation must not expose an error from a candidate the serial search skips.
    return { kind: job.kind, status: "error", error: error instanceof Error ? error.message : String(error) }
  }
}

/** Both existing repair stages own disjoint route sets and use immutable inputs. */
export function executeParallelStageJob(
  job: ParallelStageWorkerJob,
): ParallelStageWorkerResult {
  switch (job.kind) {
    case "globalDrcForceTrial":
      return executeParallelGlobalDrcTrial(job)
    case "simplifyPathWave":
      return pathWaveExecutor.execute(job)
    case "pathingGoalBalls":
      return executeParallelGoalBallJob(job)
    case "pathingNegotiatedRoute":
      return executeNegotiatedPathingRouteJob(job)
    case "pathingLandmark":
      return { kind: job.kind, ...computeTinyLandmarkDistances(job.graph, job.landmarkPortId) }
    case "regionalFallbackSolve":
      return executeRegionalFallback(job)
    case "regionalB01Candidate":
      return executeRegionalB01Candidate(job)
    case "forceImproveNode":
      return executeForceImproveNode(job)
    case "repairNode":
      return executeRepairNode(job)
    case "forceImproveNodeBatch": {
      assertParallelNodeBatchJob(job)
      const results: ParallelIndexedNodeResult<ParallelForceImproveNodeResult>[] = []
      for (const entry of job.jobs) {
        results.push({ entryIndex: entry.entryIndex, result: executeForceImproveNode(entry.job) })
      }
      return { kind: job.kind, results }
    }
    case "repairNodeBatch": {
      assertParallelNodeBatchJob(job)
      const results: ParallelIndexedNodeResult<ParallelRepairNodeResult>[] = []
      for (const entry of job.jobs) {
        results.push({ entryIndex: entry.entryIndex, result: executeRepairNode(entry.job) })
      }
      return { kind: job.kind, results }
    }
    case "simplifyPathComponent": {
      const solver = new MultiSimplifiedPathSolver({
        ...job.params,
        connMap: restoreWorkerConnectivityMap(job),
      })
      if (job.params.preserveLeadingLayerTransitions) preserveLeadingPathLayerTransitions(solver)
      solver.solve()
      if (solver.failed || !solver.solved) {
        throw new Error(`Parallel path simplification failed: ${solver.error}`)
      }
      return { kind: job.kind, routes: solver.simplifiedHdRoutes }
    }
  }
}
