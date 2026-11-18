import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { join } from "node:path"
import { SOLVERS } from "@tscircuit/core"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./runtime.mjs"
import { compactAliases } from "./compactAliases"

const [id, kind, variant, folder] = process.argv.slice(2)
const preparationStarted = performance.now()
mkdirSync(folder, { recursive: true })
const manifest = JSON.parse(readFileSync(new URL("./captured/manifest.json", import.meta.url), "utf8"))
const fixture = manifest.find((row: any) => row.id === id && row.kind === kind)
if (!fixture) throw new Error(`Missing captured input ${id}/${kind}`)
const original = JSON.parse(gunzipSync(readFileSync(new URL(fixture.file, import.meta.url))).toString())
let input = structuredClone(original)
const removed: { name: string; nativeName: string; terminals: number }[] = []
if (variant === "without_ground" || variant === "without_large_nets") {
  input.connections = input.connections.filter((connection: any) => {
    const net = fixture.nets[connection.name]
    if (!net) throw new Error(`Missing native net metadata: ${connection.name}`)
    const remove = variant === "without_ground" ? net.isGround : connection.pointsToConnect.length > 16
    if (remove) removed.push({ name: connection.name, nativeName: net.nativeName, terminals: connection.pointsToConnect.length })
    return !remove
  })
}
let compact: { before: number; after: number; components: number } | null = null
if (variant === "compact_aliases") {
  const result = compactAliases(input)
  input = result.input
  compact = { before: result.before, after: result.after, components: result.components }
}
if (!["baseline", "without_ground", "without_large_nets", "compact_aliases"].includes(variant)) throw new Error(`Unknown variant ${variant}`)
const started = performance.now()
const preparationMs = started-preparationStarted
const limitMs = 180000
const solver: any = kind === "bus"
  ? new SOLVERS.BusLanesPipelineSolver(input)
  : new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
const stages: Record<string, { calls: number; ms: number }> = {}
const timeline: { stage: string; atMs: number }[] = []
let previousStage = "", lastSave = 0, status = "running"
const stageName = (): string => kind === "bus" ? solver.phase : solver.getCurrentPhase()
const save = (): void => {
  const state = {
    id, kind, variant, status, preparationMs, elapsedMs: performance.now()-started, solved: solver.solved, failed: solver.failed, error: solver.error,
    connections: input.connections.length, terminals: input.connections.reduce((n: number, c: any) => n+c.pointsToConnect.length, 0),
    estimatedMstEdges: input.connections.reduce((n: number, c: any) => n+Math.max(0,c.pointsToConnect.length-1),0),
    obstacles: input.obstacles.length, aliases: input.obstacles.reduce((n: number,o: any) => n+o.connectedTo.length,0),
    removed, compact, stage: stageName(), stages, timeline,
    iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
    active: solver.activeSubSolver ? { name: solver.activeSubSolver.constructor.name, iterations: solver.activeSubSolver.iterations, maxIterations: solver.activeSubSolver.MAX_ITERATIONS, error: solver.activeSubSolver.error } : null,
    busStats: kind === "bus" ? solver.stats : null,
    pipelineTimes: kind === "board" ? solver.timeSpentOnPhase : null,
    declaration: removed.length ? "Reduced-demand diagnostic only; never a full-board pass" : "Same geometry, requested nets and constraints as the captured phase",
  }
  writeFileSync(join(folder,"replay.json"),JSON.stringify(state,null,2))
  lastSave = performance.now()
}
save()
while (!solver.solved && !solver.failed && performance.now()-started < limitMs) {
  const stage = stageName()
  if (stage !== previousStage) { timeline.push({ stage, atMs: performance.now()-started }); previousStage = stage; save() }
  const begin = performance.now()
  solver.step()
  const row = stages[stage] ??= { calls: 0, ms: 0 }
  row.calls++; row.ms += performance.now()-begin
  if (performance.now()-lastSave > 1000) save()
}
status = solver.solved ? "solved" : solver.failed ? "failed" : "timeout"
if (solver.solved) {
  const traces = kind === "bus" ? solver.getOutput().traces : solver.getOutputSimplifiedPcbTraces()
  writeFileSync(join(folder,"traces.json"),JSON.stringify(traces))
}
save()
console.log(JSON.stringify({id,kind,variant,status,elapsedMs:performance.now()-started,removed:removed.length,compact}))
