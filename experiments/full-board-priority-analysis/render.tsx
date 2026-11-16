import { EventEmitter } from "node:events"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { GenericLocalAutorouter } from "@tscircuit/core"
import { RootCircuit, SOLVERS } from "./core-runtime.mjs"
import type { AutoroutingPhaseProps } from "@tscircuit/props"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { NativeFullBoard, type FullBoardSource } from "./native-full-board"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./runtime.mjs"

const [id, output, mode = "fanout"] = process.argv.slice(2)
const source: FullBoardSource = JSON.parse(readFileSync(new URL(`./${id}/source.json`, import.meta.url), "utf8"))
mkdirSync(output, { recursive: true })
const circuit = new RootCircuit()
// Fanout follow-up stages must use the same workspace router as explicit phases.
Object.assign(SOLVERS, { AutoroutingPipelineSolver9_PreloadedTraceGraph })
const started = performance.now()
const routingBudgetMs = Number(process.env.FULL_BOARD_ROUTING_BUDGET_MS ?? "600000")
function checkRoutingBudget(): void {
  if (performance.now()-started > routingBudgetMs) throw new Error("Full-board routing budget exhausted")
}
const progress = {
  id, mode, status: "running", renderCompleted: false, elapsedMs: 0,
  phases: [] as { name: string; solver: string; status: string; connections: number; startedMs: number; elapsedMs?: number }[],
  errors: [] as string[], stage: "initializing", initialCopperElements: null as number | null,
  runtime: { tscircuit: "0.0.3204", core: "0.0.2397", fanout: "0.0.84", busLanes: "0.0.58", autorouter: "workspace Pipeline 9", routerCommit: process.env.FULL_BOARD_ROUTER_COMMIT ?? "workspace checkout; see runtime.mjs" },
  planeIntent: { enabled: mode !== "legacy", zones: source.planeIntent.zones.length, importedSavedCopper: source.planeIntent.savedCopperImported },
}
const diagnostics = {
  timeline: [] as { phase: string; stage: string; atMs: number }[],
  busStageMs: {} as Record<string, number>,
  busLastState: null as unknown,
  pipelineLastState: null as unknown,
  fanoutLastState: null as unknown,
  phaseInputs: [] as unknown[],
}
let lastDiagnosticWrite = 0
const lastBusStages = new WeakMap<object,string>()
function saveDiagnostics(): void {
  writeFileSync(join(output,"diagnostics.json"),JSON.stringify(diagnostics,null,2))
  lastDiagnosticWrite = performance.now()
}
const busPrototype = SOLVERS.BusLanesPipelineSolver.prototype as any
const originalBusStep = busPrototype.step
busPrototype.step = function (...args: unknown[]): unknown {
  checkRoutingBudget()
  const stage = this.phase
  const phase = progress.phases.findLast((p) => p.status === "running")?.name ?? "bus"
  const stageChanged = stage !== lastBusStages.get(this)
  if(stageChanged) {
    diagnostics.timeline.push({phase,stage,atMs:performance.now()-started})
    lastBusStages.set(this,stage)
  }
  if (performance.now()-lastDiagnosticWrite > 1000) {
    diagnostics.busLastState = {phase,stage,iterations:this.iterations,maxIterations:this.MAX_ITERATIONS,failureCode:this.failureCode,
      native:this.stats?.nativeSingleCarrier,groups:this.stats?.nativeGroups,
      child:this.child?{phase:this.child.phase,iterations:this.child.iterations,failureCode:this.child.failureCode}:null}
    saveDiagnostics()
  }
  const begin = performance.now()
  try { return originalBusStep.apply(this,args) }
  finally { diagnostics.busStageMs[`${phase}/${stage}`]=(diagnostics.busStageMs[`${phase}/${stage}`]??0)+performance.now()-begin }
}
const fanoutPrototype = SOLVERS.FanoutSolver.prototype
const originalFanoutStep = fanoutPrototype.step
fanoutPrototype.step = function (...args: Parameters<typeof originalFanoutStep>): ReturnType<typeof originalFanoutStep> {
  checkRoutingBudget()
  if (this.iterations === 0) console.log("FANOUT_RECHECK_FIRST_STEP")
  const result = originalFanoutStep.apply(this,args)
  if (this.failed || this.solved || performance.now()-lastDiagnosticWrite > 1000) {
    const runtimeSolver = this as any
    diagnostics.fanoutLastState = {iterations:this.iterations, failed:this.failed, solved:this.solved,
      error:this.error, phase:runtimeSolver.phase, stats:runtimeSolver.stats, properties:Object.keys(this)}
    saveDiagnostics()
  }
  return result
}

function save(includeSvg = false): void {
  progress.elapsedMs = performance.now() - started
  const json = circuit.getCircuitJson()
  writeFileSync(join(output, "circuit.tmp"), JSON.stringify(json))
  renameSync(join(output, "circuit.tmp"), join(output, "circuit.json"))
  writeFileSync(join(output, "progress.tmp"), JSON.stringify(progress, null, 2))
  renameSync(join(output, "progress.tmp"), join(output, "progress.json"))
  if (includeSvg) {
    writeFileSync(join(output, "pcb.svg"), convertCircuitJsonToPcbSvg(json, {
      width: 1600, height: 1100, backgroundColor: "#10141c",
      shouldDrawRatsNest: false, shouldDrawErrors: false, showPcbGroups: false,
      viewport: { minX: -source.width/2-2, maxX: source.width/2+2, minY: -source.height/2-2, maxY: source.height/2+2 },
    }))
  }
}

const algorithmFn: AutoroutingPhaseProps["algorithmFn"] = async (input): Promise<GenericLocalAutorouter> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
  const events = new EventEmitter()
  let timer: ReturnType<typeof setTimeout> | undefined
  const step = (): void => {
    try {
      checkRoutingBudget()
      const until = performance.now() + 25
      while (!solver.solved && !solver.failed && performance.now() < until) solver.step()
      progress.stage = solver.getCurrentPhase()
      const runtimeSolver = solver as any
      diagnostics.pipelineLastState = {phase:progress.phases.findLast((p)=>p.status==="running")?.name,
        stage:progress.stage,iterations:runtimeSolver.iterations,times:{...runtimeSolver.timeSpentOnPhase},
        active:runtimeSolver.activeSubSolver?{name:runtimeSolver.activeSubSolver.constructor.name,iterations:runtimeSolver.activeSubSolver.iterations,maxIterations:runtimeSolver.activeSubSolver.MAX_ITERATIONS,error:runtimeSolver.activeSubSolver.error}:null}
      if(performance.now()-lastDiagnosticWrite>1000)saveDiagnostics()
      if (solver.failed) throw new Error(solver.error!)
      if (solver.solved) {
        events.emit("complete", { type: "complete", traces: solver.getOutputSimplifiedPcbTraces() })
      } else {
        timer = setTimeout(step, 0)
      }
    } catch (error) {
      events.emit("error", { type: "error", error })
    }
  }
  return {
    input, isRouting: false, on: events.on.bind(events),
    start(): void { timer = setTimeout(step, 0) },
    stop(): void { clearTimeout(timer); events.removeAllListeners() },
    solveSync(): never { throw new Error("This full-board renderer uses asynchronous routing") },
    getOutputSimpleRouteJson: solver.getOutputSimpleRouteJson.bind(solver) as GenericLocalAutorouter["getOutputSimpleRouteJson"],
  }
}

for (const eventName of ["autorouting:start", "autorouting:end", "autorouting:error"] as const) {
  circuit.on(eventName, (event: any) => {
    const groupId = event.simpleRouteJson?.connections[0]?.routingPcbGroupId
    const groupName = circuit.getCircuitJson().find((e: any) => e.type === "pcb_group" && e.pcb_group_id === groupId) as { name?: string } | undefined
    const name = event.phaseName ?? groupName?.name ?? "fanout preparation"
    if (eventName === "autorouting:start") {
      if (progress.initialCopperElements === null) {
        const json = circuit.getCircuitJson()
        progress.initialCopperElements = json.filter((e) => ["pcb_trace", "pcb_via", "pcb_copper_pour"].includes(e.type)).length
        writeFileSync(join(output, "unrouted.circuit.json"), JSON.stringify(json))
        if (progress.initialCopperElements !== 0) throw new Error("Fresh-route input contains existing copper")
      }
      progress.phases.push({ name, solver: event.solverName ?? (event.phaseName ? "workspace Pipeline 9" : "FanoutSolver"), status: "running", connections: event.simpleRouteJson.connections.length, startedMs: performance.now()-started })
      diagnostics.phaseInputs.push({name,connections:event.simpleRouteJson.connections.length,
        terminals:event.simpleRouteJson.connections.reduce((n:number,c:any)=>n+c.pointsToConnect.length,0),
        obstacles:event.simpleRouteJson.obstacles.length,
        aliases:event.simpleRouteJson.obstacles.reduce((n:number,o:any)=>n+o.connectedTo.length,0)})
      writeFileSync(join(output, `phase-${progress.phases.length}-input.srj.json`), JSON.stringify(event.simpleRouteJson))
    } else {
      const phase = progress.phases.findLast((p) => p.status === "running")
      if (!phase && eventName !== "autorouting:error") throw new Error(`Routing finish without start: ${name}`)
      if (phase) {
        phase.status = eventName === "autorouting:end" ? "completed" : "failed"
        phase.elapsedMs = performance.now()-started-phase.startedMs
      } else {
        progress.phases.push({ name, solver: "fanout preparation", status: "failed", connections: 0, startedMs: performance.now()-started, elapsedMs: 0 })
      }
      if (event.simpleRouteJson) writeFileSync(join(output, `phase-${progress.phases.length}-output.srj.json`), JSON.stringify(event.simpleRouteJson))
      if (eventName === "autorouting:error") progress.errors.push(event.error?.message ?? String(event.error))
    }
    save(true)
    saveDiagnostics()
    console.log(`${id} ${eventName} ${name}`)
    if (eventName === "autorouting:error") {
      progress.status = "failed"
      save()
    }
  })
}
circuit.on("asyncEffect:end", (event: any) => {
  if (event.error) { progress.errors.push(String(event.error)); save() }
})
const heartbeat = setInterval(() => save(), 2000)
try {
  console.log("FANOUT_RECHECK_ADD_BEGIN")
  circuit.add(<NativeFullBoard source={source} algorithmFn={algorithmFn} geometryOnly={mode === "geometry"} fanout={mode === "fanout"} planes={mode !== "legacy"} />)
  console.log("FANOUT_RECHECK_RENDER_BEGIN")
  const rendering = circuit.renderUntilSettled()
  console.log("FANOUT_RECHECK_RENDER_PROMISE_RETURNED")
  await rendering
  progress.renderCompleted = true
  for (const element of circuit.getCircuitJson()) {
    if (element.type === "pcb_autorouting_error") progress.errors.push(element.message)
  }
  progress.status = progress.errors.length || progress.phases.some((p) => p.status !== "completed") ? "failed" : mode === "geometry" ? "geometry_only" : "completed"
} catch (error) {
  progress.errors.push(String(error))
  progress.status = "failed"
} finally {
  clearInterval(heartbeat)
  save(true)
  saveDiagnostics()
  console.log(JSON.stringify(progress))
}
