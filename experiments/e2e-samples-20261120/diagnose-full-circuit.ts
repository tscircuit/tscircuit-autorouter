import { plugin } from "bun"
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"

const [folderArgument, sample] = process.argv.slice(2)
const folder = resolve(folderArgument)
const destination = join(folder, "diagnosis")
mkdirSync(destination, { recursive: true })
const layerProbes: unknown[] = []
;(globalThis as any).__e2eLayerProbe = (observation: unknown): void => { layerProbes.push(observation) }
plugin({ name: "record-existing-layer-preflight", setup(build) {
  build.onLoad({ filter: /[\/]fanout-solver\.ts$/ }, async ({ path }) => {
    let source = await Bun.file(path).text()
    const skipped = "  if (busUsesCoordinatedWinding(bus)) return allowedEscapeLayers"
    const marker = "  // Existing plans only add clearance constraints, so a layer that cannot"
    if (source.split(skipped).length !== 2 || source.split(marker).length !== 2) throw new Error("Preflight observer markers changed")
    source = source.replace(skipped, `  if (busUsesCoordinatedWinding(bus)) {
      ;(globalThis as any).__e2eLayerProbe({ busId: bus.busId, connectionCount: bus.connections.length, allowedEscapeLayers, individuallyRoutableLayers: null, coordinatedPreflightSkipped: true })
      return allowedEscapeLayers
    }`)
    source = source.replace(marker, `  ;(globalThis as any).__e2eLayerProbe({ busId: bus.busId, connectionCount: bus.connections.length, allowedEscapeLayers, individuallyRoutableLayers, coordinatedPreflightSkipped: false })
` + marker)
    return { contents: source, loader: "ts" }
  })
}})
const fanoutRoot = resolve("core/node_modules/@tscircuit/fanout-solver/lib")
const { FanoutSolver } = await import(join(fanoutRoot, "fanout-solver.ts"))
const geometry = await import(join(fanoutRoot, "geometry.ts"))
const { getPlanSegments, getPlanVias } = await import(join(fanoutRoot, "route-bus/plan-copper.ts"))
const { connectionsShareElectricalNet } = await import(join(fanoutRoot, "net-identity.ts"))
const { validateRoutedCopperDrc } = await import(join(fanoutRoot, "validate-routed-copper-drc.ts"))
const { visualizeSimpleRouteJson } = await import(join(fanoutRoot, "visualize-simple-route-json.ts"))
const { getSvgFromGraphicsObject } = await import(resolve("core/node_modules/graphics-debug"))
const readCompressed = (name: string) => JSON.parse(gunzipSync(new Uint8Array(readFileSync(join(folder, name)))).toString())
const report = JSON.parse(readFileSync(join(folder, "report.json"), "utf8"))
const processResult = JSON.parse(readFileSync(join(folder, "process.json"), "utf8"))
const identitySnapshotName = readdirSync(folder).includes("circuit.json.gz") ? "circuit.json.gz" : processResult.timedOut && readdirSync(folder).includes("unrouted.circuit.json.gz") ? "unrouted.circuit.json.gz" : undefined
if (!identitySnapshotName) throw new Error("No captured PCB available for component-name lookup")
const circuit = readCompressed(identitySnapshotName)
const names = new Map<string, string>()
const components = new Map(circuit.filter((entry: any) => entry.type === "source_component").map((entry: any) => [entry.source_component_id, entry.name]))
for (const entry of circuit) {
  if (entry.type === "source_net") names.set(entry.source_net_id, entry.name)
  if (entry.type === "source_trace") {
    const label = entry.display_name ?? entry.name
    if (label) { names.set(entry.source_trace_id, label); if (entry.subcircuit_connectivity_map_key) names.set(entry.subcircuit_connectivity_map_key, label) }
  }
  if (entry.type === "source_port") names.set(entry.source_port_id, `${components.get(entry.source_component_id) ?? "component"}.${entry.name ?? entry.pin_number ?? "pin"}`)
}
for (const entry of circuit) if (entry.type === "pcb_port" && names.has(entry.source_port_id)) names.set(entry.pcb_port_id, names.get(entry.source_port_id)!)
for (const entry of circuit) if (entry.type === "pcb_smtpad" && names.has(entry.pcb_port_id)) names.set(entry.pcb_smtpad_id, names.get(entry.pcb_port_id)!)
const identity = (plan: any): string => names.get(plan.sourcePoint?.pcb_port_id) ?? names.get(plan.connectionName) ?? plan.busId?.replace(/^ESC_(.+)_pin(.+)$/, "$1.pin$2") ?? "unnamed escape"
const sourceInputs = readdirSync(folder).filter((name) => name.startsWith("started-") && name.endsWith("-FanoutSolver.json.gz")).sort()
const fanoutRows: unknown[] = []
let inputIndex = 0
const exampleFile = join(folder, "fanout-rejection-examples.json.gz")
const examples = JSON.parse(gunzipSync(new Uint8Array(readFileSync(exampleFile))).toString())
for (const solverReport of report.solvers) {
  if (solverReport.name !== "FanoutSolver") continue
  const capture = readCompressed(sourceInputs[inputIndex++])
  const [input, options] = capture.args
  const state = readCompressed(`solver-${solverReport.id}-state.json.gz`)
  const best = state.bestAttempt
  const solver = new FanoutSolver(input, options)
  const started = performance.now()
  while (!Reflect.get(solver, "routingInitialized") && performance.now() - started < 120000) Reflect.get(solver, "stepRoutingInitialization").call(solver)
  const preflight = { complete: Boolean(Reflect.get(solver, "routingInitialized")), elapsedMs: performance.now() - started, buses: structuredClone(layerProbes) }
  layerProbes.length = 0
  const plans = best?.plans ?? []
  const routed = new Set(plans.map((plan: any) => plan.connectionName))
  const byConnection = new Map(solver.preparedBuses.flatMap((bus: any) => bus.connections.map((connection: any) => [connection.connection.name, { connection, bus }])))
  const missing = input.connections.filter((connection: any) => !routed.has(connection.name)).map((connection: any) => {
    const prepared: any = byConnection.get(connection.name)
    return { connection: connection.name, label: prepared ? identity({ ...prepared.connection, connectionName: connection.name, busId: prepared.bus.busId }) : names.get(connection.name), bus: prepared?.bus.busId, width: prepared?.bus.traceWidth ?? solver.config.traceWidth }
  })
  const rejected = examples.map(([key, rejection]: [string, any]) => {
    const reason = key.split("|").at(-1)
    let gap: number | null = null
    if (rejection.segment && rejection.obstacle) gap = geometry.distanceSegmentToObstacle(rejection.segment, rejection.obstacle) - rejection.segment.width / 2
    if (rejection.via && rejection.obstacle) gap = geometry.distancePointToObstacle(rejection.via.center, rejection.obstacle) - rejection.via.diameter / 2
    let sameNet: boolean | undefined
    if (rejection.otherPlan) sameNet = connectionsShareElectricalNet(input, rejection.plan.connectionName, rejection.otherPlan.connectionName)
    return { key, connection: rejection.plan.connectionName, label: identity(rejection.plan), reason, missingInBest: !routed.has(rejection.plan.connectionName), blocker: rejection.otherPlan ? identity(rejection.otherPlan) : rejection.obstacle?.connectedTo?.map((id: string) => names.get(id)).filter(Boolean).join(", "), gapMm: gap, requiredClearanceMm: rejection.clearance, recognizedSameNet: sameNet, ownSourceObstacle: rejection.obstacle && JSON.stringify(rejection.obstacle) === JSON.stringify(rejection.plan.sourceObstacle) }
  })
  if (best) {
    const graphics = visualizeSimpleRouteJson(best.outputSrj)
    graphics.title = `${sample}: partial fanout ${best.summary.routedConnectionCount}/${input.connections.length} escapes; not committed board routing`
    writeFileSync(join(destination, `fanout-${solverReport.id}-partial.svg`), getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }))
  }
  let mergeExperiment: unknown
  if (["icepi-original", "imx6-original", "imx6-spaced"].includes(sample)) {
    const experiment = new FanoutSolver(input, { ...options, allowSameNetMerges: true })
    const experimentStarted = performance.now()
    while (!experiment.solved && !experiment.failed && performance.now() - experimentStarted < 180000) experiment.step()
    const experimentBest = Reflect.get(experiment, "bestAttempt")
    const drc = experimentBest ? validateRoutedCopperDrc({ inputSrj: input, routedSrj: experimentBest.outputSrj, clearance: experiment.config.clearance, allowBlindAndBuriedVias: experiment.config.allowBlindAndBuriedVias, allowSameNetMerges: true }) : null
    mergeExperiment = { isolatedFanout: true, endToEnd: false, option: "allowSameNetMerges=true", solved: experiment.solved, failed: experiment.failed, error: experiment.error, bestEscapes: experimentBest?.summary.routedConnectionCount ?? 0, requested: input.connections.length, elapsedMs: performance.now() - experimentStarted, completedAssignments: experiment.attempts.length, drc }
    if (experimentBest) writeFileSync(join(destination, "same-net-merge-experiment.json.gz"), Bun.gzipSync(JSON.stringify(experimentBest)))
  }
  fanoutRows.push({ solverId: solverReport.id, config: solver.config, preparedBusCount: solver.preparedBuses.length, requested: input.connections.length, bestEscapes: best?.summary.routedConnectionCount ?? 0, missing, preflight, rejections: rejected, mergeExperiment })
}
const windingRows = report.solvers.filter((solver: any) => solver.name === "WindingBreakoutSolver").map((solver: any) => {
  const input = readCompressed(`solver-${solver.id}-input.json.gz`)[0]
  const state = readCompressed(`solver-${solver.id}-state.json.gz`)
  return { id: solver.id, solved: solver.solved, failed: solver.failed, error: solver.error, phases: solver.phases, child: state.child, connections: input.connections.length, regions: input.regions, buses: input.buses, boundaryPointSpacing: input.boundaryPointSpacing }
})
const result = { sample, identitySnapshotName, identitySnapshotIsFinal: identitySnapshotName === "circuit.json.gz", processResult, fanout: fanoutRows, winding: windingRows, finalCounts: report.counts, phases: report.phases, sourceRevisions: report.revisions }
writeFileSync(join(destination, "analysis.json"), JSON.stringify(result, null, 2))
console.log("E2E_INTERNAL_DIAGNOSIS", JSON.stringify({ sample, fanout: fanoutRows.map((row: any) => ({ requested: row.requested, bestEscapes: row.bestEscapes, isolatedNoLayerBuses: row.preflight.buses.filter((bus: any) => Array.isArray(bus.individuallyRoutableLayers) && bus.individuallyRoutableLayers.length === 0).length, coordinatedPreflightSkipped: row.preflight.buses.filter((bus: any) => bus.coordinatedPreflightSkipped).length, mergeExperiment: row.mergeExperiment })), windingFailed: windingRows.filter((row: any) => row.failed).map((row: any) => ({ error: row.error, child: row.child, connections: row.connections })) }))
