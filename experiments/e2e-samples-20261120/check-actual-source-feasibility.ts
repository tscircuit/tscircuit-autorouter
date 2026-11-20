import { readFileSync, writeFileSync, readdirSync, copyFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { join, resolve } from "node:path"
const destination = "published/experiments/e2e-samples-20261120/interception-results"
const root = resolve("core/node_modules/@tscircuit/fanout-solver/lib")
const { FanoutSolver } = await import(join(root, "fanout-solver.ts"))
const { planIsStaticallyClear } = await import(join(root, "route-bus/plan-static-clearance.ts"))
const { obstacleSharesElectricalNet } = await import(join(root, "net-identity.ts"))
const { distancePointToObstacle } = await import(join(root, "geometry.ts"))
const { getPlanVias } = await import(join(root, "route-bus/plan-copper.ts"))
const { checkViasInPads } = await import(resolve("core/node_modules/@tscircuit/checks"))
const readGzip = (path: string) => JSON.parse(gunzipSync(new Uint8Array(readFileSync(path))).toString())
const write = (path: string, contents: unknown): void => writeFileSync(path, JSON.stringify(contents, null, 2))
const findings: unknown[] = []
for (const sample of readdirSync("diagnoses")) {
  const name = sample.replace("full-circuit-diagnosis-", "")
  const data = JSON.parse(readFileSync(join("diagnoses", sample, "analysis.json"), "utf8"))
  const capture = join("captures", "full-circuit-interception-" + name, name)
  const target = join(destination, name)
  for (const winding of data.winding.filter((entry: any) => entry.failed)) copyFileSync(join(capture, `solver-${winding.id}-input.json.gz`), join(target, `winding-failure-${winding.id}-input.json.gz`))
  if (!data.fanout.length) continue
  const fanout = data.fanout[0]
  const inputPath = join(capture, `solver-${fanout.solverId}-input.json.gz`)
  copyFileSync(inputPath, join(target, "fanout-input.json.gz"))
  const [input, options] = readGzip(inputPath)
  const solver = new FanoutSolver(input, options)
  const config = solver.config
  const exits = input.connections.flatMap((connection: any) => connection.pointsToConnect.filter((point: any) => String(point.pointId).startsWith("pcb_breakout_point_")).map((point: any) => {
    const sourcePoint = connection.pointsToConnect.find((candidate: any) => candidate.pcb_port_id)
    const metadata = input.obstacles.find((obstacle: any) => obstacle.circuitJsonMetadata?.pcb_port_id === sourcePoint?.pcb_port_id)?.circuitJsonMetadata
    const foreignPours = input.obstacles.filter((obstacle: any) => obstacle.isCopperPour && obstacle.layers.includes(point.layer) && !obstacleSharesElectricalNet(input, obstacle, connection.name) && distancePointToObstacle(point, obstacle) < (connection.width ?? config.traceWidth) / 2 + config.clearance - 1e-9)
    return { connection: connection.name, source: metadata ? `${metadata.source_component_name}.${metadata.source_port_name}` : "unnamed escape", point, requiredTraceToCopperGap: config.clearance, foreignPourCount: foreignPours.length, insideForeignPour: foreignPours.some((obstacle: any) => distancePointToObstacle(point, obstacle) === 0), foreignPourExamples: foreignPours.slice(0, 2).map((obstacle: any) => ({ center: obstacle.center, width: obstacle.width, height: obstacle.height, layers: obstacle.layers, distance: distancePointToObstacle(point, obstacle), circuitJsonMetadata: obstacle.circuitJsonMetadata })) }
  }))
  const exitSummary = { sample: name, checkedExits: exits.length, exitsConflictingWithForeignPours: exits.filter((exit: any) => exit.foreignPourCount > 0).length, exitsInsideForeignPours: exits.filter((exit: any) => exit.insideForeignPour).length, checkedAgainst: "Unmodified FanoutSolver input and the native electrical-net and obstacle-distance predicates", exits }
  write(join(target, "exit-obstacle-audit.json"), exitSummary)
  findings.push({ ...exitSummary, exits: undefined })
  const experimentPath = join("diagnoses", sample, "same-net-merge-experiment.json.gz")
  if (fanout.mergeExperiment) {
    const best = readGzip(experimentPath)
    copyFileSync(experimentPath, join(target, "same-net-merge-experiment.json.gz"))
    const circuit = readGzip(join(capture, "circuit.json.gz"))
    const vias = best.plans.flatMap((plan: any, planIndex: number) => getPlanVias(plan).map((via: any, viaIndex: number) => ({ type: "pcb_via", pcb_via_id: `analysis-via-${planIndex}-${viaIndex}`, pcb_trace_id: plan.trace.pcb_trace_id, x: via.center.x, y: via.center.y, outer_diameter: via.diameter, hole_diameter: via.holeDiameter, layers: via.spanLayers })))
    const viaInPad = checkViasInPads([...circuit, ...vias])
    const result = { sample: name, isolatedFanoutOnly: true, baselineEscapes: fanout.bestEscapes, experimentalEscapes: fanout.mergeExperiment.bestEscapes, nativeCopperDrcValid: fanout.mergeExperiment.drc.valid, independentlyCheckedVias: vias.length, viaInPadFindingCount: viaInPad.length, viaInPadFindings: viaInPad }
    write(join(target, "same-net-merge-independent-check.json"), result)
    findings.push(result)
  }
  if (!["icepi-original", "imx6-original"].includes(name)) continue
  const sourceLabel = name === "icepi-original" ? "U22.BALL_B5" : "U10.BALL_B2"
  const selected = fanout.rejections.find((entry: any) => entry.label === sourceLabel && entry.reason === "pad-trace")
  const examples = readGzip(join(capture, "fanout-rejection-examples.json.gz"))
  const recordedPlan = examples.find(([key]: [string]) => key === selected.key)[1].plan
  const sourcePadId = recordedPlan.sourceObstacle.circuitJsonMetadata?.pcb_smtpad_id
  if (!sourcePadId) throw new Error("Captured source pad metadata is missing")
  const sourceObstacle = input.obstacles.find((obstacle: any) => obstacle.circuitJsonMetadata?.pcb_smtpad_id === sourcePadId)
  if (!sourceObstacle) throw new Error("Captured source pad identity could not be restored")
  const plan = { ...recordedPlan, sourceObstacle }
  if (name === "icepi-original") {
    const start = plan.sourcePoint
    const points = [start, { x: start.x + 0.25, y: start.y - 0.25 }, { x: start.x + 0.25, y: start.y - 1 }]
    const segments = points.slice(1).map((end, index) => ({ start: points[index], end, width: fanout.missing.find((entry: any) => entry.connection === plan.connectionName).width, layer: plan.sourceLayer }))
    const bus = solver.preparedBuses.find((entry: any) => entry.busId === plan.busId)!
    const layers = config.escapeLayers.filter((layer: string) => layer !== plan.sourceLayer && (bus.allowedLayers?.includes(layer) ?? true))
    const results = layers.map((targetLayer: string) => {
      const trial = { ...plan, targetLayer, segments, sourceEscapeSegmentCount: segments.length, exitPoint: points.at(-1), via: { center: points.at(-1), diameter: config.viaDiameter, holeDiameter: config.viaHoleDiameter, fromLayer: plan.sourceLayer, toLayer: targetLayer, spanLayers: config.layerNames }, additionalVias: [], planeEndpointSegments: [], planeEndpointVia: undefined }
      return { targetLayer, staticClearancePass: planIsStaticallyClear({ plan: trial, srj: input, sharedBoundary: bus.sharedBoundary, clearance: config.clearance, allowBlindAndBuriedVias: config.allowBlindAndBuriedVias, allowSameNetMerges: config.allowSameNetMerges }) }
    })
    const result = { sample: name, source: "U22.B5", declaredExit: input.connections[plan.connectionIndex].pointsToConnect.find((point: any) => String(point.pointId).startsWith("pcb_breakout_point_")), sourceCorridorOnly: true, fullDeclaredExitNotRouted: true, unchangedWidth: segments[0].width, unchangedClearance: config.clearance, unchangedViaDiameter: config.viaDiameter, points, checks: results }
    write(join(target, "source-corridor-check.json"), result);findings.push(result)
  } else {
    const center = plan.sourcePoint
    const circles = input.obstacles.filter((pad: any) => pad !== sourceObstacle && pad.shape === "circle" && pad.layers.includes(plan.sourceLayer) && pad.componentId === sourceObstacle.componentId)
    const pitch = Math.min(...circles.map((pad: any) => Math.hypot(pad.center.x - center.x, pad.center.y - center.y)).filter((distance: number) => distance > 1e-6))
    const ring = [-1, 0, 1].flatMap(dx => [-1, 0, 1].flatMap(dy => dx === 0 && dy === 0 ? [] : [{ dx, dy }])).map(({dx,dy}) => circles.find((pad: any) => Math.hypot(pad.center.x - center.x - dx * pitch, pad.center.y - center.y - dy * pitch) < 1e-6))
    if (ring.some((pad: any) => !pad)) throw new Error("The actual pad ring is incomplete; no enclosure proof")
    ring.sort((a: any,b: any) => Math.atan2(a.center.y-center.y,a.center.x-center.x)-Math.atan2(b.center.y-center.y,b.center.x-center.x))
    const width = fanout.missing.find((entry: any) => entry.connection === plan.connectionName).width
    const joins = ring.map((pad: any,index: number) => { const next=ring[(index+1)%ring.length];return { distance: Math.hypot(pad.center.x-next.center.x,pad.center.y-next.center.y), forbiddenRadiusSum: (Math.min(pad.width,pad.height)+Math.min(next.width,next.height))/2+width+2*config.clearance } })
    const allForeign = ring.every((pad: any) => !obstacleSharesElectricalNet(input,pad,plan.connectionName))
    const viaForbiddenRadius = Math.min(...[sourceObstacle,...ring].map((pad: any) => Math.min(pad.width,pad.height)/2))+config.viaDiameter/2+config.clearance
    const result = { sample:name, source:"U10.B2", sourcePadDiameter:sourceObstacle.width, traceWidth:width, clearance:config.clearance, viaDiameter:config.viaDiameter, viaInPadEnabled:input.allowViaInPad===true, allowSameNetMerges:config.allowSameNetMerges, pitch, allEightNeighborsAreForeign:allForeign, ringJoins:joins, traceCenterRingClosed:allForeign&&joins.every((pair: any)=>pair.distance<pair.forbiddenRadiusSum), viaGridCoveringRadius:pitch/Math.sqrt(2), viaForbiddenRadius, viaInsideRingBlocked:viaForbiddenRadius>pitch/Math.sqrt(2)&&input.allowViaInPad!==true&&config.allowSameNetMerges===false, policy:"Enclosure proof applies to the captured baseline's surface-trace and via rules, not arbitrary PCB manufacturing assumptions or the same-net experiment." }
    write(join(target,"source-enclosure-proof.json"),result);findings.push(result)
  }
}
write(join(destination,"feasibility-checks.json"),findings)
console.log("ACTUAL_FEASIBILITY_CHECKS",JSON.stringify(findings.map((entry:any)=>({...entry,viaInPadFindings:undefined,ringJoins:undefined}))))
