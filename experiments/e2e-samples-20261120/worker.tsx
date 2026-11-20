import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { RootCircuit } from "../lib/RootCircuit"
import { SOLVERS } from "../lib/solvers"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"

type ObservedSolver = {
  step(): void
  constructor: { name: string }
  iterations: number
  solved: boolean
  failed: boolean
  error: string | null
  phase?: string
  stats?: unknown
  failureCode?: string
  activeSubSolver?: ObservedSolver
  child?: ObservedSolver
  attempts?: unknown
  bestAttempt?: unknown
  preparedBuses?: unknown
  timeSpentOnPhase?: Record<string, number>
  getCurrentPhase?: () => string
  getConstructorParams?: () => unknown[]
  visualize?: () => GraphicsObject
  pipelineDef?: { solverName: string; getConstructorParams: (solver: ObservedSolver) => unknown[] }[]
}

const [sample, destination] = process.argv.slice(2)
const output = resolve(destination)
mkdirSync(output, { recursive: true })
const started = performance.now()
const budgetMs = Number(process.env.E2E_BUDGET_MS ?? 600_000)
const circuit = new RootCircuit()
const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(process.env.E2E_ROUTER_MODULE!)
Object.assign(SOLVERS, { AutoroutingPipelineSolver9_PreloadedTraceGraph })
const report = {
  sample, status: "running", renderCompleted: false, elapsedMs: 0,
  initialCopper: null as number | null,
  phases: [] as { name: string; solver?: string; status: string; connections: number; startedMs: number; elapsedMs?: number }[],
  solvers: [] as { id: number; name: string; phases: { stage: string; atMs: number }[]; iterations: number; solved: boolean; failed: boolean; error: string | null; stats?: unknown; times?: Record<string, number> }[],
  errors: [] as string[], counts: {} as Record<string, number>,
  revisions: JSON.parse(await Bun.file(join(import.meta.dir, "revisions.json")).text()),
}
const observed = new WeakMap<object, { id: number; stage: string; persistedAt: number }>()

function capture(name: string, contents: unknown): void {
  const serialized = JSON.stringify(contents, (_key, entry) => {
    if (entry instanceof Map) return { kind: "Map", entries: [...entry] }
    if (entry instanceof Set) return { kind: "Set", entries: [...entry] }
    if (typeof entry === "number" && !Number.isFinite(entry)) return String(entry)
    return entry
  })
  writeFileSync(join(output, `${name}.json.gz`), Bun.gzipSync(serialized))
}

function save(): void {
  report.elapsedMs = performance.now() - started
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2))
}

function observe(solver: ObservedSolver): void {
  let previous = observed.get(solver)
  const stage = solver.getCurrentPhase?.() ?? solver.phase ?? solver.constructor.name
  if (!previous) {
    const id = report.solvers.length
    previous = { id, stage: "", persistedAt: 0 }
    observed.set(solver, previous)
    report.solvers.push({ id, name: solver.constructor.name, phases: [], iterations: 0, solved: false, failed: false, error: null })
    if (solver.getConstructorParams) capture(`solver-${id}-input`, solver.getConstructorParams())
  }
  const summary = report.solvers[previous.id]
  if (previous.stage !== stage) {
    summary.phases.push({ stage, atMs: performance.now() - started })
    previous.stage = stage
    const definition = solver.pipelineDef?.find((entry) => entry.solverName === stage)
    if (definition) capture(`solver-${previous.id}-stage-${stage}-input`, definition.getConstructorParams(solver))
    console.log("STAGE", sample, previous.id, stage)
  }
  if (solver.solved || solver.failed || performance.now() - previous.persistedAt > 1000) {
    Object.assign(summary, { iterations: solver.iterations, solved: solver.solved, failed: solver.failed, error: solver.error, stats: solver.stats, times: solver.timeSpentOnPhase })
    const child = solver.activeSubSolver ?? solver.child
    capture(`solver-${previous.id}-state`, {
      stage, iterations: solver.iterations, solved: solver.solved, failed: solver.failed,
      error: solver.error, stats: solver.stats, failureCode: solver.failureCode,
      child: child ? { name: child.constructor.name, phase: child.phase, iterations: child.iterations, failed: child.failed, error: child.error, stats: child.stats, failureCode: child.failureCode } : null,
      attempts: solver.attempts, bestAttempt: solver.bestAttempt,
    })
    previous.persistedAt = performance.now()
    save()
  }
  if ((solver.failed || solver.solved) && solver.visualize) {
    const graphics = solver.visualize()
    writeFileSync(join(output, `solver-${previous.id}-final.svg`), getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }))
  }
}

for (const constructor of [SOLVERS.FanoutSolver, SOLVERS.BusLanesPipelineSolver, SOLVERS.AutoroutingPipelineSolver9_PreloadedTraceGraph]) {
  const prototype = constructor.prototype as ObservedSolver
  const step = prototype.step
  prototype.step = function (): void {
    if (performance.now() - started > budgetMs) throw new Error("E2E routing budget exhausted")
    observe(this)
    try { step.call(this) }
    finally { observe(this) }
  }
}

circuit.on("solver:started", (event) => {
  capture(`started-${Date.now()}-${event.solverName}`, { name: event.solverName, component: event.componentName, args: event.solverConstructorArgs })
})
for (const eventName of ["autorouting:start", "autorouting:end", "autorouting:error"] as const) {
  circuit.on(eventName, (event) => {
    if (eventName === "autorouting:start") {
      const json = circuit.getCircuitJson()
      if (report.initialCopper === null) {
        report.initialCopper = json.filter((element) => element.type === "pcb_trace" || element.type === "pcb_via").length
        capture("unrouted.circuit", json)
      }
      report.phases.push({ name: event.phaseName ?? event.componentDisplayName, solver: event.solverName, status: "running", connections: event.simpleRouteJson!.connections.length, startedMs: performance.now() - started })
    } else {
      const phase = report.phases.findLast((entry) => entry.status === "running")
      if (phase) {
        phase.status = eventName === "autorouting:end" ? "completed" : "failed"
        phase.elapsedMs = performance.now() - started - phase.startedMs
      }
      if (eventName === "autorouting:error") report.errors.push(event.error?.message ?? "Autorouting failed without a message")
    }
    if (event.simpleRouteJson) capture(`phase-${report.phases.length}-${eventName.split(":")[1]}`, event.simpleRouteJson)
    console.log("PHASE", sample, eventName, event.phaseName ?? event.componentDisplayName)
    save()
  })
}

const heartbeat = setInterval(save, 2000)
try {
  const { default: Board } = await import(`./samples/${sample}.tsx`)
  circuit.add(Board())
  await circuit.renderUntilSettled()
  report.renderCompleted = true
  const json = circuit.getCircuitJson()
  for (const element of json) {
    if (element.type === "pcb_autorouting_error") report.errors.push(element.message)
  }
  report.status = report.errors.length ? "failed" : "completed"
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error))
  report.status = report.errors.some((message) => message.includes("budget exhausted")) ? "budget_exhausted" : "failed"
} finally {
  clearInterval(heartbeat)
  const json = circuit.getCircuitJson()
  capture("circuit", json)
  for (const element of json) report.counts[element.type] = (report.counts[element.type] ?? 0) + 1
  writeFileSync(join(output, "pcb.svg"), convertCircuitJsonToPcbSvg(json, {
    width: 1600, height: 1100, backgroundColor: "white", shouldDrawRatsNest: false,
    shouldDrawErrors: false, showPcbGroups: false,
  }))
  save()
  console.log("E2E_REPORT", JSON.stringify(report))
}
process.exit(0)
