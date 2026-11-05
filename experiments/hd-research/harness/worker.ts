import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

// Measurement hooks live outside every checkout and never change solver policy.
// A fresh process loads precisely one checkout for precisely one sample.
const [taskPath] = process.argv.slice(2)
const task = await Bun.file(taskPath).json()
const checkout = task.checkout
const progressIntervalMs = 1000
const resultPath = task.resultPath
const { extractBenchmarkStageTiming } = await import(
  join(checkout, "scripts/benchmark/benchmark-stage-timing.ts")
)
let currentSolver: any
let solveStartedAt = 0
let previousPhase = -1
let lastProgressAt = -Infinity
let observedSteps = 0
let capturedHdInput: any

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function send(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function peakRssBytes(): number {
  return process.resourceUsage().maxRSS * 1024
}

function captureHdConstructor(solver: any): void {
  solver.pipelineDef = solver.pipelineDef.map((phase: any): any => {
    if (phase.solverName !== "highDensityRouteSolver") return phase
    const getConstructorParams = phase.getConstructorParams
    if (typeof getConstructorParams !== "function") {
      throw new Error("HD constructor callback is missing")
    }
    return {
      ...phase,
      getConstructorParams(instance: any): readonly unknown[] {
        const params = getConstructorParams.call(phase, instance)
        const started = performance.now()
        const source = params[0]
        const packed = {
          ...source,
          connMap: { netMap: source.connMap.netMap },
          nodePfById: source.nodePfById instanceof Map
            ? [...source.nodePfById]
            : source.nodePfById,
          nodePfByIdIsMap: source.nodePfById instanceof Map,
        }
        const text = JSON.stringify(packed)
        const sha256 = createHash("sha256").update(text).digest("hex")
        const inputPath = join(task.inputDirectory,
          `${task.dataset}-${String(task.sampleNumber).padStart(3, "0")}-${sha256}.json`)
        mkdirSync(dirname(inputPath), { recursive: true })
        writeFileSync(inputPath, text, { flag: "w" })
        capturedHdInput = {
          path: inputPath, sha256, bytes: Buffer.byteLength(text),
          captureMs: performance.now() - started,
          nodeCount: source.nodePortPoints.length,
          layerCount: source.layerCount,
          fixedRouteCount: source.fixedHdRoutes.length,
        }
        send({ type: "hdInput", value: capturedHdInput })
        return params
      },
    }
  })
}

function emitProgress(solver: any, force = false): void {
  const phaseIndex = solver.currentPipelineStepIndex
  if (!force && phaseIndex === previousPhase && (++observedSteps & 255) !== 0) return
  const now = performance.now()
  if (!force && phaseIndex === previousPhase && now - lastProgressAt < progressIntervalMs) return
  lastProgressAt = now
  previousPhase = phaseIndex
  const phase = solver.pipelineDef[phaseIndex]
  const hd = solver.highDensityRouteSolver
  const active = solver.activeSubSolver
  send({ type: "progress", value: {
    elapsedTimeMs: now - solveStartedAt,
    phaseName: phase?.solverName,
    phaseSolverName: phase?.solverClass?.name ?? active?.getSolverName?.(),
    solverIterations: solver.iterations,
    solverProgress: solver.progress,
    activeSubSolverIterations: active?.iterations,
    activeSubSolverProgress: active?.progress,
    stageTiming: extractBenchmarkStageTiming(solver, "partial", now),
    peakRssBytes: peakRssBytes(),
    highDensity: hd ? {
      iterations: hd.iterations, progress: hd.progress,
      stats: hd.stats, diagnostics: hd.benchmarkDiagnosticCounters,
      activeNodeId: hd.activeNode?.capacityMeshNodeId,
      remainingNodes: hd.unsolvedNodePortPoints?.length,
    } : undefined,
  } })
}

function geometryMetrics(traces: any[]): unknown {
  let viaCount = 0
  let wireLengthMm = 0
  for (const trace of traces) {
    for (let i = 0; i < trace.route.length; i++) {
      const point = trace.route[i]
      if (point.route_type === "via") viaCount++
      const previous = trace.route[i - 1]
      if (previous && point.route_type === "wire") {
        wireLengthMm += Math.hypot(point.x - previous.x, point.y - previous.y)
      }
    }
  }
  return { traceCount: traces.length, viaCount, wireLengthMm, traceHash: hash(traces) }
}

async function runFullPipeline(): Promise<unknown> {
  const { AutoroutingPipelineSolver9_PreloadedTraceGraph: Pipeline } = await import(
    join(checkout, "lib/index.ts")
  )
  const { loadScenarioBySampleNumber } = await import(
    join(checkout, "scripts/benchmark/scenarios.ts")
  )
  const { runTask } = await import(join(checkout, "scripts/benchmark/benchmark-run-task.ts"))
  const { scenarioName, scenario } = await loadScenarioBySampleNumber(
    task.dataset, task.sampleNumber, task.effort,
  )
  const originalStep = Pipeline.prototype._step
  Pipeline.prototype._step = function (): void {
    if (!currentSolver) {
      currentSolver = this
      captureHdConstructor(this)
    }
    originalStep.call(this)
    emitProgress(this)
  }
  send({ type: "started", scenarioName, startedAt: new Date().toISOString() })
  solveStartedAt = performance.now()
  const result = await runTask({
    datasetName: task.dataset,
    solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    scenarioName,
    sampleNumber: task.sampleNumber,
    scenario,
    threads: 1,
  }, {
    onProgress(progress: any): void {
      solveStartedAt = performance.now() - progress.elapsedTimeMs
      // The solveAsync(undefined) path is synchronous; the _step observer above
      // supplies heartbeat events while the standard timer cannot run.
    },
  })
  if (result.benchmarkSnapshot) {
    const { imageSvg: omitted, ...snapshot } = result.benchmarkSnapshot
    result.benchmarkSnapshot = snapshot
  }
  const output = result.didSolve ? currentSolver.getOutputSimpleRouteJson() : null
  const traces = result.didSolve ? currentSolver.getOutputSimplifiedPcbTraces() : []
  if (task.saveOutput && output) {
    writeFileSync(resultPath.replace(/\.json$/, ".output.json"), JSON.stringify(output))
  }
  return {
    ...result,
    ...geometryMetrics(traces),
    outputHash: output ? hash(output) : null,
    peakRssBytes: peakRssBytes(),
    hdInput: capturedHdInput,
    highDensity: currentSolver?.highDensityRouteSolver ? {
      solved: currentSolver.highDensityRouteSolver.solved,
      failed: currentSolver.highDensityRouteSolver.failed,
      iterations: currentSolver.highDensityRouteSolver.iterations,
      stats: currentSolver.highDensityRouteSolver.stats,
      diagnostics: currentSolver.highDensityRouteSolver.benchmarkDiagnosticCounters,
    } : null,
  }
}

async function runHdReplay(): Promise<unknown> {
  const { ConnectivityMap } = await import(join(checkout, "node_modules/circuit-json-to-connectivity-map/dist/index.js"))
  const { Pipeline9HighDensitySolver } = await import(join(checkout,
    "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver.ts"))
  const packed = await Bun.file(task.hdInput).json()
  const { nodePfByIdIsMap, ...source } = packed
  const params = {
    ...source,
    connMap: new ConnectivityMap(source.connMap.netMap),
    nodePfById: nodePfByIdIsMap === false ? source.nodePfById : new Map(source.nodePfById),
  }
  if (task.nodeIds?.length) {
    const selected = new Set(task.nodeIds)
    params.nodePortPoints = params.nodePortPoints.filter((node: any): boolean => selected.has(node.capacityMeshNodeId))
  }
  const solver = new Pipeline9HighDensitySolver(params)
  let lastProgress = -Infinity
  let activeNode: any = null
  let nodeStartedAt = 0
  let nodeStartIteration = 0
  let routeOffset = 0
  const nodes: unknown[] = []
  send({ type: "started", startedAt: new Date().toISOString() })
  solveStartedAt = performance.now()
  while (!solver.solved && !solver.failed) {
    const previousNode = solver.activeNode
    const previousNow = previousNode === null ? performance.now() : 0
    solver.step()
    if (previousNode === null && solver.activeNode) {
      activeNode = solver.activeNode
      nodeStartedAt = previousNow
      nodeStartIteration = solver.iterations - 1
      routeOffset = solver.routes.length
    }
    if (previousNode !== null && solver.activeNode === null && activeNode) {
      const routes = solver.routes.slice(routeOffset)
      nodes.push({
        id: activeNode.capacityMeshNodeId, ports: activeNode.portPoints.length,
        elapsedTimeMs: performance.now() - nodeStartedAt,
        iterations: solver.iterations - nodeStartIteration,
        routeCount: routes.length, routeHash: hash(routes),
      })
      activeNode = null
    }
    if ((solver.iterations & 255) === 0) {
      const now = performance.now()
      if (now - lastProgress > progressIntervalMs) {
        lastProgress = now
        send({ type: "progress", value: {
          elapsedTimeMs: now - solveStartedAt,
          phaseName: "highDensityRouteSolver",
          peakRssBytes: peakRssBytes(),
          highDensity: {
            iterations: solver.iterations, stats: solver.stats,
            diagnostics: solver.benchmarkDiagnosticCounters,
            activeNodeId: solver.activeNode?.capacityMeshNodeId,
            completedNodes: nodes.length,
            remainingNodes: solver.unsolvedNodePortPoints.length,
          },
        } })
      }
    }
  }
  const elapsedTimeMs = performance.now() - solveStartedAt
  if (task.saveOutput) {
    writeFileSync(resultPath.replace(/\.json$/, ".output.json"), JSON.stringify(solver.routes))
  }
  return {
    elapsedTimeMs,
    didSolve: solver.solved,
    failed: solver.failed,
    error: solver.error,
    didTimeout: false,
    // An HD-stage completion is not final board DRC success.
    relaxedDrcPassed: null,
    routeHash: hash(solver.routes),
    routeCount: solver.routes.length,
    peakRssBytes: peakRssBytes(),
    iterations: solver.iterations,
    nodeCount: params.nodePortPoints.length,
    remainingNodes: solver.unsolvedNodePortPoints.length,
    stats: solver.stats,
    diagnostics: solver.benchmarkDiagnosticCounters,
    nodes,
  }
}

try {
  const workerStartedAt = performance.now()
  const result = task.mode === "hd" ? await runHdReplay() : await runFullPipeline()
  const report = {
    schemaVersion: 1, ...task,
    childPid: process.pid,
    completedAt: new Date().toISOString(),
    workerElapsedTimeMs: performance.now() - workerStartedAt,
    result,
  }
  writeFileSync(resultPath, JSON.stringify(report, null, 2))
  send({ type: "result", value: report })
} catch (error) {
  const report = {
    schemaVersion: 1, ...task,
    completedAt: new Date().toISOString(),
    result: {
      didSolve: false, didTimeout: false, relaxedDrcPassed: false,
      elapsedTimeMs: solveStartedAt ? performance.now() - solveStartedAt : 0,
      peakRssBytes: peakRssBytes(),
      error: error instanceof Error ? error.stack : String(error),
      errorPhaseName: currentSolver?.pipelineDef[currentSolver.currentPipelineStepIndex]?.solverName,
    },
  }
  writeFileSync(resultPath, JSON.stringify(report, null, 2))
  send({ type: "result", value: report })
  process.exitCode = 1
}
