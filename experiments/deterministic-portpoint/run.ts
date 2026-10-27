import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {mkdirSync, writeFileSync} from "node:fs"
import {dirname} from "node:path"
import {AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {loadScenarioBySampleNumber} from "../../scripts/benchmark/scenarios"
import {SnapshotBatchSolver} from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/snapshot/SnapshotBatchSolver"
import {SolverRuntime} from "@tscircuit/solver-utils/runtime/bun"
import type {TinyHyperGraphSolver} from "tiny-hypergraph/lib/core"

/** Reconstruct every route and check graph-level hard constraints independently. */
function validate(solver: TinyHyperGraphSolver): void {
  const {problem, topology, state} = solver
  const edges = Array.from({length:problem.routeCount}, () => new Map<number, number[]>())
  const portOwners = new Map<number, number>()
  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    for (const [routeId, from, to] of state.regionSegments[regionId]!) {
      for (const portId of [from,to]) {
        assert.ok(topology.incidentPortRegion[portId]!.includes(regionId))
        assert.ok(!portOwners.has(portId) || portOwners.get(portId) === problem.routeNet[routeId])
        portOwners.set(portId,problem.routeNet[routeId]!)
      }
      assert.ok(problem.regionNetId[regionId] === -1 || problem.regionNetId[regionId] === problem.routeNet[routeId])
      edges[routeId]!.set(from,[...(edges[routeId]!.get(from) ?? []),to])
      edges[routeId]!.set(to,[...(edges[routeId]!.get(to) ?? []),from])
    }
    const mask = topology.regionAvailableZMask?.[regionId] ?? 0
    if (mask > 0 && (mask & (mask - 1)) === 0) {
      const segments = state.regionSegments[regionId]!
      const angle = (port: number): number => topology.incidentPortRegion[port]![0] === regionId
        ? topology.portAngleForRegion1[port]!
        : topology.portAngleForRegion2![port]!
      for (let i = 0; i < segments.length; i++) {
        const [routeId,from,to] = segments[i]!
        const lo = Math.min(angle(from),angle(to))
        const hi = Math.max(angle(from),angle(to))
        for (let j = i+1; j < segments.length; j++) {
          const [other,from2,to2] = segments[j]!
          if (problem.routeNet[routeId] === problem.routeNet[other]) continue
          const inside1 = lo < angle(from2) && angle(from2) < hi
          const inside2 = lo < angle(to2) && angle(to2) < hi
          assert.equal(inside1,inside2,`Forbidden single-layer crossing in region ${regionId}`)
        }
      }
    }
  }
  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const seen = new Set<number>()
    const pending = [problem.routeStartPort[routeId]!]
    while (pending.length) {
      const portId = pending.pop()!
      if (seen.has(portId)) continue
      seen.add(portId)
      pending.push(...(edges[routeId]!.get(portId) ?? []))
    }
    assert.ok(seen.has(problem.routeEndPort[routeId]!), `Route ${routeId} is disconnected`)
    assert.ok([...edges[routeId]!.keys()].every(portId=>seen.has(portId)), `Route ${routeId} contains disconnected segments`)
  }
}

const sample = Number(process.argv[2] ?? 6)
const mode = process.argv[3] ?? "new1"
const batchSize = Number(process.argv[4] ?? 8)
const densityFactor = Number(process.env.PROTOTYPE_DENSITY ?? 0)
const output = process.argv[5] ?? `work/snapshot-${sample}-${mode}.json`
assert.ok(["original","new1","new4"].includes(mode), "Mode must be original, new1, or new4")
assert.equal(batchSize,8,"SolverRuntime integration uses fixed eight-route waves")
assert.equal(densityFactor,0,"SolverRuntime integration preserves the original cost function")
const {scenario} = await loadScenarioBySampleNumber("srj18",sample)
const pipelineStart = performance.now()
const pipeline = new Pipeline9(structuredClone(scenario),{effort:1,cacheProvider:null})
while (pipeline.getCurrentPhase() !== "portPointPathingSolver") {
  pipeline.step()
  assert.equal(pipeline.failed,false,pipeline.error ?? "Upstream stage failed")
}
const definition = pipeline.pipelineDef.find(step => step.solverName === "portPointPathingSolver")!
const getParams = definition.getConstructorParams.bind(definition)
definition.getConstructorParams = ((instance: typeof pipeline) => {
  const params = getParams(instance) as any[]
  params[0].flags.USE_SNAPSHOT_BATCH_ROUTING = mode !== "original"
  return params
}) as typeof definition.getConstructorParams
const start = performance.now()
const cpuStart = process.cpuUsage()
pipeline.step()
const portSolver = pipeline.portPointPathingSolver as any
const afterSetup = performance.now()
let dispatched = 0
if (mode === "new4") {
  const runtime = new SolverRuntime({workerCount:4,workerUrl:new URL("../../lib/runtime/bun.worker.ts",import.meta.url),requireWorker:true})
  try {
    await portSolver.solveAsync({executeAsync: (Solver: any, input: any) => {
      dispatched++
      return runtime.executeAsync(Solver,input)
    }})
  } finally { await runtime.dispose() }
  assert.ok(dispatched > 0, "Port-point work must dispatch through SolverRuntime")
} else {
  portSolver.solve()
}
const graphSolver = portSolver.tinyPipelineSolver.getSolver("solveGraph")
const batchSolver = graphSolver instanceof SnapshotBatchSolver ? graphSolver : undefined
assert.equal(portSolver.solved,true,portSolver.error ?? "Port-point stage failed")
const elapsedMs = performance.now()-start
const cpu = process.cpuUsage(cpuStart)
const solver = portSolver.tinyPipelineSolver.getSolvedTinySolver() as TinyHyperGraphSolver
validate(solver)
const stageOutput = portSolver.getOutput()
const hash = createHash("sha256").update(JSON.stringify(stageOutput)).digest("hex")
const report = {
  sample,mode,batchSize,densityFactor,dispatched,elapsedMs,cpuMs:(cpu.user+cpu.system)/1000,setupMs:afterSetup-start,routeCount:solver.problem.routeCount,
  portCount:solver.topology.portCount,regionCount:solver.topology.regionCount,
  hash,metrics:portSolver.getSolveGraphBenchmarkMetrics(),batchStats:batchSolver?.batchStats,
  stateStats:solver.stats, coordinatorStats:batchSolver?.stats,
}
mkdirSync(dirname(output),{recursive:true})
writeFileSync(output,JSON.stringify(report,null,2))
writeFileSync(output.replace(/\.json$/,"-output.json"),JSON.stringify(stageOutput))
console.log(JSON.stringify(report))
if (process.env.PROTOTYPE_DOWNSTREAM === "1") {
  const {SolverRuntime} = await import("@tscircuit/solver-utils/runtime/bun")
  const {evaluateRelaxedDrc} = await import("../../lib/testing/evaluate-relaxed-drc")
  const runtime = new SolverRuntime({workerCount:4,workerUrl:new URL("../../lib/runtime/bun.worker.ts",import.meta.url),requireWorker:true})
  const downstreamStart = performance.now()
  const heartbeat = setInterval(()=>console.log(JSON.stringify({downstreamPhase:pipeline.getCurrentPhase(),elapsedSeconds:(performance.now()-downstreamStart)/1000})),10_000)
  try { await pipeline.solveAsync(runtime) } finally { clearInterval(heartbeat); await runtime.dispose() }
  const downstreamMs = performance.now()-downstreamStart
  const traces = pipeline.solved ? pipeline.getOutputSimplifiedPcbTraces() : []
  const drc = pipeline.solved ? evaluateRelaxedDrc({inputSrj:scenario,srjWithPointPairs:pipeline.srjWithPointPairs!,routedTraces:traces}) : undefined
  const downstream = {mode,sample,batchSize,densityFactor,solved:pipeline.solved,failed:pipeline.failed,error:pipeline.error,upstreamMs:start-pipelineStart,stageMs:elapsedMs,downstreamMs,totalFromPortpointMs:elapsedMs+downstreamMs,pipelineMs:start-pipelineStart+elapsedMs+downstreamMs,traceCount:traces.length,drcErrors:drc?.errors.length,phases:pipeline.timeSpentOnPhase}
  writeFileSync(output.replace(/\.json$/,"-downstream.json"),JSON.stringify(downstream,null,2))
  console.log(JSON.stringify(downstream))
}
