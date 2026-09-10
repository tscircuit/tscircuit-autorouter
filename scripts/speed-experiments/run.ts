import { parseArgs } from "node:util"
import { mkdir, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9RegularNodeSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { convertSrjToGraphicsObject } from "../../lib/utils/convertSrjToGraphicsObject"
import { loadScenarioBySampleNumber } from "../benchmark/scenarios"
import { installPolicy, POLICY_NAMES } from "./policies"
import { evaluateNodeQuality } from "./quality"

const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
  mode: { type: "string" }, approach: { type: "string" }, output: { type: "string" },
} })
if (!values.output || !values.mode || !values.approach) throw new Error("Required: --mode node|sample --approach NAME --output DIR")
if (!POLICY_NAMES.includes(values.approach as any)) throw new Error(`Unknown approach ${values.approach}`)
const out = resolve(values.output)
await mkdir(out, { recursive: true })
const policy = installPolicy(values.approach as any)
const common = {
  approach: values.approach, mode: values.mode, policy: policy.metadata,
  baseCommit: "2b24a39e585fb9f1a642d1a7f7432de81c219b68",
  experimentCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
  machine: process.env.RUNNER_NAME, platform: process.platform, arch: process.arch,
  bunVersion: Bun.version, effort: 1, cache: "fresh process, default in-memory cache; no network cache",
}
async function save(name: string, value: unknown): Promise<void> {
  await writeFile(`${out}/${name}.json`, JSON.stringify(value, null, 2))
}

try {
  if (values.mode === "node") {
    const params = await Bun.file(new URL("node-params.json", import.meta.url)).json()
    const connMap = new ConnectivityMap(params.connMap.netMap)
    const portfolios: Array<{ solver: any; startMs: number }> = []
    const originalInitialize = PortfolioSingleIntraNodeSolver.prototype.initializeSolvers
    let start = 0
    PortfolioSingleIntraNodeSolver.prototype.initializeSolvers = function (): void {
      portfolios.push({ solver: this, startMs: performance.now() - start })
      originalInitialize.call(this)
    }
    start = performance.now()
    const solver = createPipeline9RegularNodeSolver({ ...params, nodeWithPortPoints: params.node, connMap, nodePfById: {} })
    solver.solve()
    const elapsedMs = performance.now() - start
    PortfolioSingleIntraNodeSolver.prototype.initializeSolvers = originalInitialize
    const attempts = portfolios.map(({ solver: p, startMs }, index) => ({
      scale: p.nodeWithPortPoints.width / params.node.width, startMs,
      elapsedMs: (portfolios[index + 1]?.startMs ?? elapsedMs) - startMs,
      solved: p.solved, failed: p.failed, error: p.error, iterations: p.iterations,
      stats: p.stats, candidates: p.supervisedSolvers.map((s: any) => ({
        name: s.solver.getSolverName(), hyperParameters: s.hyperParameters,
        solved: s.solver.solved, failed: s.solver.failed, iterations: s.solver.iterations,
        winner: p.winningSolver === s.solver, progress: s.solver.progress,
        solvedConnectionCount: s.solver.solvedConnectionsMap?.size,
        solvedRouteCount: s.solver.solvedRoutes?.length,
      })),
    }))
    const quality = evaluateNodeQuality({ ...params, solved: solver.solved, failed: solver.failed, routes: solver.routes })
    await save("result", { ...common, elapsedMs, solved: solver.solved, failed: solver.failed,
      error: solver.error, iterations: solver.iterations, stats: solver.stats, quality, attempts, events: policy.events })
    await save("routes", solver.routes)
    await save("graphics", solver.visualize())
    for (let i = 0; i < portfolios.length; i++) await save(`attempt-${i}`, portfolios[i].solver.visualize())
    console.log(JSON.stringify({ mode: "node", approach: values.approach, elapsedMs, solved: solver.solved, quality }))
  } else if (values.mode === "sample") {
    const { scenario } = await loadScenarioBySampleNumber("srj18", 2)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1 })
    const start = performance.now()
    solver.solve()
    const elapsedMs = performance.now() - start
    const traces = solver.solved ? solver.getOutputSimplifiedPcbTraces() : null
    const drcStart = performance.now()
    const drc = traces ? evaluateRelaxedDrc({ inputSrj: scenario, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: traces }) : null
    const drcEvaluationMs = performance.now() - drcStart
    await save("result", { ...common, elapsedMs, drcEvaluationMs, solved: solver.solved, failed: solver.failed,
      error: solver.error, iterations: solver.iterations, traceCount: traces?.length,
      viaCount: drc?.circuitJson.filter((element) => element.type === "pcb_via").length,
      finalRelaxedDrcCount: drc?.errors.length, errors: drc?.errorsWithCenters,
      fingerprint: traces ? createHash("sha256").update(JSON.stringify(traces)).digest("hex") : null,
      timeSpentOnPhase: solver.timeSpentOnPhase,
      jointStats: solver.pipeline9JointDrcRepairSolver?.stats,
      hdStats: solver.highDensityRouteSolver?.stats,
      events: policy.events,
    })
    if (traces) {
      await save("traces", traces)
      await save("final-srj", solver.getOutputSimpleRouteJson())
      await save("graphics", convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson()))
    }
    if (solver.highDensityRouteSolver?.solved) await save("hd-graphics", solver.highDensityRouteSolver.visualize())
    console.log(JSON.stringify({ mode: "sample", approach: values.approach, elapsedMs, solved: solver.solved, drc: drc?.errors.length }))
  } else throw new Error(`Unknown mode: ${values.mode}`)
} catch (error) {
  await save("exception", { ...common, error: String(error), stack: error instanceof Error ? error.stack : null })
  throw error
} finally {
  policy.restore()
}
