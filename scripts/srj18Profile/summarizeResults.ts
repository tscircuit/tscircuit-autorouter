import { mkdir, readdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type {
  ClassTiming,
  NodeSolverTiming,
  NodeSummary,
  SampleResult,
  SampleSummary,
  SampleStageSummary,
  StageSummary,
} from "./reportTypes"
import { attributeNodeWrappers } from "./attributeNodeWrappers"

type StageName = string
type SolverKey = string
type NodeKey = string

export function median(measurements: number[]): number {
  if (!measurements.length)
    throw new Error("Cannot summarize an empty measurement set")
  const sorted = [...measurements].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ""
  const columns = Object.keys(rows[0]!)
  return (
    [
      columns.join(","),
      ...rows.map((row) =>
        columns
          .map((column) => {
            const field = row[column]
            const text =
              field === null || field === undefined
                ? ""
                : typeof field === "object"
                  ? JSON.stringify(field)
                  : String(field)
            return `"${text.replaceAll('"', '""')}"`
          })
          .join(","),
      ),
    ].join("\n") + "\n"
  )
}

export async function summarizeResults(outDir: string): Promise<void> {
  const directories = await readdir(outDir)
  const baselineDirs = directories
    .filter((directory) => /^baseline-\d+$/.test(directory))
    .sort()
  const baselines: SampleResult[] = []
  const manifests = directories.filter((name) =>
    /^manifest-.*\.json$/.test(name),
  )
  const environment = (await Bun.file(
    resolve(outDir, manifests[0]!),
  ).json()) as { platform: string }
  for (const directory of baselineDirs) {
    for (const file of (await readdir(resolve(outDir, directory)))
      .filter((file) => /^sample\d{3}\.json$/.test(file))
      .sort()) {
      const result = (await Bun.file(
        resolve(outDir, directory, file),
      ).json()) as SampleResult
      // Initial run schema followed Node's KiB convention. Bun 1.3.9 on
      // Darwin exposes bytes here. Keep raw files intact and normalize reports.
      if (!result.schemaVersion && environment.platform === "darwin")
        result.peakRssBytes /= 1024
      baselines.push(result)
    }
  }
  if (!baselines.length) throw new Error("No baseline results found")
  const sampleIds = [
    ...new Set(baselines.map((result) => result.sampleId)),
  ].sort()
  const samples: SampleSummary[] = []
  const sampleStages: SampleStageSummary[] = []
  const nodes: NodeSummary[] = []
  const stageMap = new Map<StageName, StageSummary>()
  const classes: ClassTiming[] = []
  const nodeSolvers: NodeSolverTiming[] = []
  const attemptsDirectory = resolve(outDir, "solver-records")
  await mkdir(attemptsDirectory, { recursive: true })
  for (const sampleId of sampleIds) {
    const runs = baselines.filter((result) => result.sampleId === sampleId)
    const first = runs[0]!
    const detailedFile = Bun.file(
      resolve(outDir, "detailed", `${sampleId}.json.gz`),
    )
    const detailed: SampleResult | null = (await detailedFile.exists())
      ? JSON.parse(
          new TextDecoder().decode(
            Bun.gunzipSync(await detailedFile.arrayBuffer()),
          ),
        )
      : null
    const attributedSolvers = detailed?.profile
      ? attributeNodeWrappers(detailed.profile.solvers)
      : []
    const solverById = new Map(
      attributedSolvers.map((solver) => [solver.id, solver]),
    )
    const solversByNode = new Map<NodeKey, typeof attributedSolvers>()
    for (const solver of attributedSolvers) {
      if (solver.stage !== "highDensityRouteSolver" || !solver.nodeId) continue
      const nodeSolvers = solversByNode.get(solver.nodeId)
      if (nodeSolvers) nodeSolvers.push(solver)
      else solversByNode.set(solver.nodeId, [solver])
    }
    const medianMs = median(runs.map((result) => result.durationMs))
    const expectedHash = first.outputSha256
    samples.push({
      sampleId,
      runs: runs.length,
      medianMs,
      minMs: Math.min(...runs.map((result) => result.durationMs)),
      maxMs: Math.max(...runs.map((result) => result.durationMs)),
      cpuMedianMs: median(
        runs.map((result) => result.cpuUserMs + result.cpuSystemMs),
      ),
      peakRssBytes: Math.max(...runs.map((result) => result.peakRssBytes)),
      solved: runs.every((result) => result.solved),
      drcErrors: first.relaxedDrcErrors?.length ?? null,
      outputParity:
        expectedHash === null || !detailed
          ? null
          : runs.every((result) => result.outputSha256 === expectedHash) &&
            detailed.outputSha256 === expectedHash,
      outcomeParity:
        detailed === null
          ? null
          : [...runs, detailed].every(
              (result) =>
                result.solved === first.solved &&
                result.failed === first.failed &&
                result.error === first.error &&
                result.iterations === first.iterations,
            ),
      error: first.error,
      detailedMs: detailed?.durationMs ?? null,
      overheadRatio: detailed ? detailed.durationMs / medianMs : null,
      connections: first.inputConnections,
      obstacles: first.inputObstacles,
      highDensityNodes: first.highDensityNodes.length,
    })
    for (const { stage } of first.stages) {
      const timings = runs.map(
        (run) => run.stages.find((timing) => timing.stage === stage)!,
      )
      const durationMs = median(timings.map((timing) => timing.durationMs))
      const internalDurationMs = median(
        timings.map((timing) => timing.internalDurationMs ?? 0),
      )
      sampleStages.push({
        sampleId,
        stage,
        durationMs,
        sharePercent: (durationMs / medianMs) * 100,
        status: timings[0]!.status,
        steps: timings[0]!.steps,
        internalDurationMs,
        omittedByInternalMs: durationMs - internalDurationMs,
      })
      let summary = stageMap.get(stage)
      if (!summary) {
        summary = {
          stage,
          durationMs: 0,
          sharePercent: 0,
          maxSampleMs: 0,
          maxSample: "",
          internalDurationMs: 0,
          omittedByInternalMs: 0,
        }
        stageMap.set(stage, summary)
      }
      summary.durationMs += durationMs
      summary.internalDurationMs += internalDurationMs
      summary.omittedByInternalMs += durationMs - internalDurationMs
      if (durationMs > summary.maxSampleMs) {
        summary.maxSampleMs = durationMs
        summary.maxSample = sampleId
      }
    }
    for (const node of first.highDensityNodes) {
      const timings = runs.flatMap((run) =>
        run.nodeTimings.filter(
          (timing) => timing.nodeId === node.capacityMeshNodeId,
        ),
      )
      const nodeSolvers = solversByNode.get(node.capacityMeshNodeId) ?? []
      const growthSolvers = nodeSolvers.filter(
        (solver) => solver.solver === "GrowShrinkHighDensityIntraNodeSolver",
      )
      const regionalRecovery = nodeSolvers.some(
        (solver) => solver.solver === "Pipeline9RegionalFallbackSolver",
      )
      let routingWinner = growthSolvers.filter((solver) => solver.solved).at(-1)
      while (routingWinner?.winningSolverId)
        routingWinner = solverById.get(routingWinner.winningSolverId)
      nodes.push({
        sampleId,
        nodeId: node.capacityMeshNodeId,
        medianMs: timings.length
          ? median(timings.map((timing) => timing.durationMs))
          : 0,
        minMs: timings.length
          ? Math.min(...timings.map((timing) => timing.durationMs))
          : 0,
        maxMs: timings.length
          ? Math.max(...timings.map((timing) => timing.durationMs))
          : 0,
        status: timings[0]?.status ?? "not_reached",
        winningSolver:
          timings[0]?.winningSolver ??
          (routingWinner
            ? `${regionalRecovery ? "regional: " : ""}${routingWinner.solver}`
            : null),
        resizeCount: timings[0]?.resizeCount ?? null,
        totalRecordedGrowthAttempts: detailed
          ? growthSolvers.reduce(
              (sum, solver) => sum + (solver.growthAttempts ?? 0),
              0,
            )
          : null,
        regionalRecovery: detailed ? regionalRecovery : null,
        width: node.width,
        height: node.height,
        x: node.center.x,
        y: node.center.y,
        ports: node.portPointCount,
        connections: node.connectionCount,
        nodePf: node.nodePf,
      })
    }
    if (!detailed?.profile) continue
    const profile = detailed.profile
    const methodsBySolver = new Map<number, typeof profile.methods>()
    for (const method of profile.methods) {
      const methods = methodsBySolver.get(method.solverId)
      if (methods) methods.push(method)
      else methodsBySolver.set(method.solverId, [method])
    }
    const classMap = new Map<SolverKey, ClassTiming>()
    const nodeSolverMap = new Map<NodeKey, NodeSolverTiming>()
    const attemptRows: Record<string, unknown>[] = []
    for (const solver of attributedSolvers) {
      const allMethods = methodsBySolver.get(solver.id) ?? []
      const methodStages = [
        ...new Set(allMethods.map((method) => method.stage)),
      ]
      for (const stage of methodStages) {
        const methods = allMethods.filter((method) => method.stage === stage)
        const selfMs = methods.reduce((sum, method) => sum + method.selfMs, 0)
        const constructionSelfMs = methods
          .filter((method) => method.method === "constructor")
          .reduce((sum, method) => sum + method.selfMs, 0)
        const constructions = methods
          .filter((method) => method.method === "constructor")
          .reduce((sum, method) => sum + method.calls, 0)
        const stepCalls = methods
          .filter((method) => method.method === "step")
          .reduce((sum, method) => sum + method.calls, 0)
        const key = `${stage}/${solver.solver}`
        let summary = classMap.get(key)
        if (!summary) {
          summary = {
            sampleId,
            stage,
            solver: solver.solver,
            records: 0,
            constructions: 0,
            stepCalls: 0,
            iterations: 0,
            selfMs: 0,
            constructionSelfMs: 0,
            solved: 0,
            failed: 0,
            unfinished: 0,
            zeroStepRecords: 0,
            cacheHits: 0,
          }
          classMap.set(key, summary)
        }
        summary.records++
        summary.constructions += constructions
        summary.stepCalls += stepCalls
        summary.iterations =
          methodStages.length > 1 || summary.iterations === null
            ? null
            : summary.iterations + (solver.iterations ?? 0)
        summary.selfMs += selfMs
        summary.constructionSelfMs += constructionSelfMs
        if (solver.solved) summary.solved++
        else if (solver.failed) summary.failed++
        else summary.unfinished++
        if (!stepCalls) summary.zeroStepRecords++
        if (solver.cacheHit) summary.cacheHits++
        if (solver.nodeId) {
          const nodeKey = `${solver.nodeId}/${key}`
          let nodeSummary = nodeSolverMap.get(nodeKey)
          if (!nodeSummary) {
            nodeSummary = {
              sampleId,
              nodeId: solver.nodeId,
              stage,
              solver: solver.solver,
              selfMs: 0,
              constructionSelfMs: 0,
              constructions: 0,
              stepCalls: 0,
              iterations: 0,
              records: 0,
            }
            nodeSolverMap.set(nodeKey, nodeSummary)
          }
          nodeSummary.selfMs += selfMs
          nodeSummary.constructionSelfMs += constructionSelfMs
          nodeSummary.constructions += constructions
          nodeSummary.stepCalls += stepCalls
          nodeSummary.iterations += solver.iterations ?? 0
          nodeSummary.records++
        }
        attemptRows.push({
          sampleId,
          ...solver,
          stage,
          selfMs,
          constructionSelfMs,
          constructions,
          stepCalls,
        })
      }
    }
    classes.push(...classMap.values())
    nodeSolvers.push(...nodeSolverMap.values())
    await writeFile(
      resolve(attemptsDirectory, `${sampleId}.csv.gz`),
      Bun.gzipSync(csv(attemptRows)),
    )
  }
  const totalMedianMs = samples.reduce(
    (sum, sample) => sum + sample.medianMs,
    0,
  )
  const stages = [...stageMap.values()]
  for (const stage of stages)
    stage.sharePercent = (stage.durationMs / totalMedianMs) * 100
  stages.sort((left, right) => right.durationMs - left.durationMs)
  nodes.sort((left, right) => right.medianMs - left.medianMs)
  classes.sort((left, right) => right.selfMs - left.selfMs)
  nodeSolvers.sort((left, right) => right.selfMs - left.selfMs)
  const durations = samples
    .map((sample) => sample.medianMs)
    .sort((left, right) => left - right)
  const summary = {
    totalMedianMs,
    averageMs: totalMedianMs / samples.length,
    p50Ms: median(durations),
    p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
    baselineRuns: baselines.length,
    samples,
    stages,
    sampleStages,
    nodes,
    classes,
    nodeSolvers,
  }
  await writeFile(resolve(outDir, "summary.json"), JSON.stringify(summary))
  for (const [name, rows] of Object.entries({
    samples,
    stages,
    sampleStages,
    nodes,
    classes,
    nodeSolvers,
  })) {
    await writeFile(resolve(outDir, `${name}.csv`), csv(rows))
  }
  console.log(
    `Report tables: samples=${samples.length} baselineRuns=${baselines.length} nodes=${nodes.length} totalMedian=${(totalMedianMs / 1000).toFixed(3)}s`,
  )
}
