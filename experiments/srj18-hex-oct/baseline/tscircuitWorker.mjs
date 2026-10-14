import fs from "node:fs"
import { AutoroutingPipelineSolver, AUTOROUTER_VERSION } from "@tscircuit/capacity-autorouter"

// The non-network pipeline and disabled cache are intentional benchmark inputs.
// Throw if a package unexpectedly attempts HTTP access during a solve.
globalThis.fetch = async () => { throw new Error("Runtime network access is disabled for the SRJ18 baseline") }
const inputSrj = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
const solveSrj = process.env.ROUTING_BOARD_EDGE_CLEARANCE === undefined ? inputSrj : { ...inputSrj, minBoardEdgeClearance: Number(process.env.ROUTING_BOARD_EDGE_CLEARANCE) }
const budgetMs = Number(process.argv[3])
const solveStartedAt = performance.now()
let solver
let caughtError = null
let partialExtractionError = null
let lastCheckpointAt = solveStartedAt

function captureResult(status) {
  let traces = []
  let outputStage = "none"
  if (solver?.solved) {
    traces = solver.getOutputSimpleRouteJson().traces
    outputStage = "final"
  } else if (solver?.highDensityStitchSolver?.solved) {
    // This API uses the same source/net mapping as the final exporter, without
    // pretending that the remaining DRC and cleanup stages have completed.
    try {
      traces = solver.getNewTracesBeforePowerExpansion()
      outputStage = "partial-post-stitch"
    } catch (error) {
      partialExtractionError = String(error?.stack ?? error)
    }
  }
  return {
    status,
    elapsedMs: performance.now() - solveStartedAt,
    solved: solver?.solved ?? false,
    failed: solver?.failed ?? false,
    error: caughtError ?? solver?.error ?? null,
    partialExtractionError,
    iterations: solver?.iterations ?? 0,
    phase: solver?.getCurrentPhase() ?? "constructor",
    phaseIndex: solver?.currentPipelineStepIndex ?? 0,
    phaseTimingsMs: solver?.timeSpentOnPhase ?? {},
    outputStage,
    actualDefaults: solver ? { viaDiameter: solver.viaDiameter, viaHoleDiameter: solver.viaHoleDiameter, minTraceWidth: solver.minTraceWidth, effort: solver.effort, capacityDepth: solver.opts.capacityDepth, minBoardEdgeClearance: solver.originalSrj.minBoardEdgeClearance ?? 0, obstacleMargin: solver.srj.defaultObstacleMargin ?? 0.15 } : null,
    autorouterVersionConstant: AUTOROUTER_VERSION,
    rawHighDensityRoutes: outputStage === "none" ? solver?.highDensityRouteSolver?.routes ?? [] : [],
    traces,
  }
}

try {
  solver = new AutoroutingPipelineSolver(solveSrj, { effort: 1, cacheProvider: null })
  process.send?.({ type: "checkpoint", result: captureResult("running") })
  while (!solver.solved && !solver.failed && performance.now() - solveStartedAt < budgetMs) {
    solver.step()
    const now = performance.now()
    if (now - lastCheckpointAt > 500) {
      process.send?.({ type: "checkpoint", result: captureResult("running") })
      lastCheckpointAt = now
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
} catch (error) {
  caughtError = String(error?.stack ?? error)
}
const status = caughtError ? "error" : solver?.solved ? "solved" : solver?.failed ? "failed" : "timeout"
let result
try {
  result = captureResult(status)
} catch (error) {
  result = { traces: [], status: "export_error", solved: solver?.solved ?? false, failed: solver?.failed ?? false, error: String(error?.stack ?? error), elapsedMs: performance.now() - solveStartedAt, phase: solver?.getCurrentPhase() }
}
await new Promise((resolve) => process.send?.({ type: "complete", result }, resolve) ?? resolve())
process.disconnect?.()
