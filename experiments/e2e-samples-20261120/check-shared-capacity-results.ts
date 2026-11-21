import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { gunzipSync } from "node:zlib"
import { WindingBreakoutSolver as BeforeWinding } from "../node_modules/@tscircuit/winding-breakout-point-solver/lib"
import { WindingBreakoutSolver as AfterWinding } from "../winding-after/lib"
import { checkViasInPads } from "@tscircuit/checks"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { FanoutSolver } from "../node_modules/@tscircuit/fanout-solver/lib/fanout-solver"
import { getPlanSegments, getPlanVias } from "../node_modules/@tscircuit/fanout-solver/lib/route-bus/plan-copper"
import { validateRoutedCopperDrc } from "../node_modules/@tscircuit/fanout-solver/lib/validate-routed-copper-drc"
import { visualizeSimpleRouteJson } from "../node_modules/@tscircuit/fanout-solver/lib/visualize-simple-route-json"

const output = process.argv[2]
mkdirSync(output, { recursive: true })
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"))
const readGzip = (path: string) => JSON.parse(gunzipSync(readFileSync(path)).toString())
const manifest = read("inputs.json")
const rows = []
let invalid = false
for (const sample of manifest.samples.map((entry: any) => entry.name.replace(/\.tsx$/, ""))) {
  const captures = ["before", "after"].map((mode) => {
    const folder = join(mode, `full-circuit-interception-${sample}`, sample)
    const report = read(join(folder, "report.json"))
    const solver = report.solvers.find((solver: any) => solver.name === "FanoutSolver")
    const internals = read(join(folder, "pipeline-internals.json"))
    return {
      mode, folder, report, solver, history: internals.completedAssignments,
      args: solver ? readGzip(join(folder, `solver-${solver.id}-input.json.gz`)) : null,
      state: solver ? readGzip(join(folder, `solver-${solver.id}-state.json.gz`)) : null,
    }
  })
  const sameInputs = isDeepStrictEqual(captures[0].args, captures[1].args)

  const comparedAssignments = Math.min(...captures.map((capture) => capture.history.length))
  const sameHistory = isDeepStrictEqual(captures[0].history.slice(0, comparedAssignments), captures[1].history.slice(0, comparedAssignments))
  const firstChangedAssignment = captures[0].history.slice(0, comparedAssignments).findIndex((summary: unknown, index: number) => !isDeepStrictEqual(summary, captures[1].history[index]))

  const completeSearches = captures.every((capture) => capture.state && (capture.state.failed || capture.state.solved))
  const identicalCompletedOutput = completeSearches ? isDeepStrictEqual(captures[0].state.bestAttempt.outputSrj, captures[1].state.bestAttempt.outputSrj) : null

  const beforeSvg = join(captures[0].folder, "pcb.svg")
  const afterSvg = join(captures[1].folder, "pcb.svg")
  const identicalPcbSvg = existsSync(beforeSvg) && existsSync(afterSvg) ? readFileSync(beforeSvg).equals(readFileSync(afterSvg)) : null
  const winding = captures.map((capture) => capture.report.solvers.filter((entry: any) => entry.name === "WindingBreakoutSolver"))
  const windingInputs = captures.map((capture, modeIndex) => winding[modeIndex].map((entry: any) => readGzip(join(capture.folder, `solver-${entry.id}-input.json.gz`))[0]))
  const matchedAfterIndexes = new Set<number>()
  const windingComparisons = []
  for (let index = 0; index < winding[0].length; index++) {
    const afterIndex = windingInputs[1].findIndex((input: unknown, candidateIndex: number) => !matchedAfterIndexes.has(candidateIndex) && isDeepStrictEqual(windingInputs[0][index], input))
    if (afterIndex < 0) throw new Error(`Original winding input missing: ${sample}/${index}`)
    matchedAfterIndexes.add(afterIndex)
    const inputs = [windingInputs[0][index], windingInputs[1][afterIndex]]
    const replay = [BeforeWinding, AfterWinding].map((Constructor, modeIndex) => {
      const solver = new Constructor(inputs[modeIndex])
      let error: string | null = null
      try { solver.solve() } catch (failure) {
        if (!(failure instanceof Error) || failure.name !== "WindingBreakoutInfeasibleError") throw failure
        error = failure.message
      }
      if (!solver.solved) return { solved: false, error }
      const points = solver.getOutput().breakoutPoints
      return { solved: true, outputSha256: new Bun.CryptoHasher("sha256").update(JSON.stringify(solver.getOutput())).digest("hex"), points: points.length, layers: Object.fromEntries([...new Set(points.map((point) => point.layer))].map((layer) => [layer, points.filter((point) => point.layer === layer).length])) }
    })
    if (replay[0].solved && replay[0].outputSha256 !== replay[1].outputSha256) throw new Error(`Working winding output changed: ${sample}/${index}`)
    if (replay[0].solved && !replay[1].solved) throw new Error(`Winding placement regressed: ${sample}/${index}`)
    if (replay[0].solved !== winding[0][index].solved || replay[1].solved !== winding[1][afterIndex].solved) throw new Error(`Captured and replayed winding status differs: ${sample}/${index}`)
    windingComparisons.push({ index, beforeId: winding[0][index].id, afterId: winding[1][afterIndex].id, before: replay[0], after: replay[1] })
  }
  const additionalWinding = winding[1].filter((_: unknown, index: number) => !matchedAfterIndexes.has(index))
  const circuits = captures.map((capture) => readGzip(join(capture.folder, "circuit.json.gz")))
  const padGeometry = circuits.map((circuit) => circuit.filter((element: any) => ["pcb_smtpad", "pcb_plated_hole", "pcb_hole"].includes(element.type)).map((element: any) => Object.fromEntries(Object.entries(element).filter(([key]) => !key.endsWith("_id") && key !== "pcb_port_id" && key !== "subcircuit_connectivity_map_key"))))
  const samePadGeometry = isDeepStrictEqual(padGeometry[0], padGeometry[1])
  if (!samePadGeometry) throw new Error(`Physical pad geometry changed: ${sample}`)
  const row = { sample, winding: windingComparisons, additionalWinding, samePadGeometry, sameFanoutConstructorInputs: sameInputs, sameCompletedAssignmentPrefix: sameHistory, comparedAssignments, firstChangedAssignment, identicalCompletedOutput, identicalPcbSvg, captures: [] as any[] }
  for (const { mode, folder, report, solver: summary, args, state, history } of captures) {
    const assessed = read(join(folder, "assessment.json"))
    if (assessed.components !== assessed.expectedComponents || assessed.pads !== assessed.expectedPads || assessed.membershipErrors.length) throw new Error(`Component or membership mismatch: ${sample}/${mode}`)
    if (report.initialCopper !== null && report.initialCopper !== 0) throw new Error(`Preexisting routes found: ${sample}/${mode}`)
    if (!summary) {
      row.captures.push({ mode, fanoutReached: false, reportStatus: report.status, process: read(join(folder, "process.json")), errors: report.errors, assessment: assessed, windingFailures: report.solvers.filter((entry: any) => entry.name === "WindingBreakoutSolver" && entry.failed).length })
      continue
    }
    const [input, options] = args
    const solver = new FanoutSolver(input, options)
    const best = state.bestAttempt
    if (!best) throw new Error(`Best partial state missing for ${sample}`)
    const circuitFilename = existsSync(join(folder, "circuit.json.gz")) ? "circuit.json.gz" : "unrouted.circuit.json.gz"
    const circuit = readGzip(join(folder, circuitFilename))
    const vias = best.plans.flatMap((plan: any, planIndex: number) => getPlanVias(plan).map((via: any, viaIndex: number) => ({ type: "pcb_via", pcb_via_id: `diagnostic-${mode}-${planIndex}-${viaIndex}`, x: via.center.x, y: via.center.y, outer_diameter: via.diameter, hole_diameter: via.holeDiameter ?? solver.config.viaHoleDiameter, layers: via.spanLayers })))
    const viaInPad = checkViasInPads([...circuit, ...vias])
    const drc = validateRoutedCopperDrc({ inputSrj: input, routedSrj: best.outputSrj, clearance: solver.config.clearance, allowBlindAndBuriedVias: solver.config.allowBlindAndBuriedVias })
    const assessment = existsSync(join(folder, "assessment.json")) ? read(join(folder, "assessment.json")) : null
    const fanoutElapsedMs = report.phases.find((phase: any) => phase.solver === "FanoutSolver")?.elapsedMs
    const wireLengthMm = best.plans.flatMap(getPlanSegments).reduce((sum: number, segment: any) => sum + Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y), 0)
    row.captures.push({
      assessment: assessed, windingFailures: report.solvers.filter((entry: any) => entry.name === "WindingBreakoutSolver" && entry.failed).length, mode, fanoutReached: true, reportStatus: report.status, process: read(join(folder, "process.json")), solved: state.solved, failed: state.failed,
      partialEscapes: best.summary.routedConnectionCount, requests: input.connections.length, fanoutElapsedMs, assignments: history.length, wireLengthMm,
      nativeVias: drc.checkedViaCount, physicalViaSites: new Set(vias.map((via: any) => JSON.stringify([via.x, via.y, via.outer_diameter, via.hole_diameter, via.layers]))).size,
      nativeDrc: drc, independentViaInPadFindings: viaInPad, checkedCircuitSnapshot: circuitFilename,
      coreTraces: circuit.filter((element: any) => element.type === "pcb_trace").length, coreVias: circuit.filter((element: any) => element.type === "pcb_via").length,
      preservedGeometry: assessment ? { components: assessment.components, expectedComponents: assessment.expectedComponents, pads: assessment.pads, expectedPads: assessment.expectedPads, membershipErrors: assessment.membershipErrors } : null,
      revisions: report.revisions,
    })
    if (sample === "glider-original" || sample === "glider-spaced") {
      const boundary = options.sharedBoundary
      const bounds = { minX: boundary.minX - 0.7, maxX: boundary.maxX + 0.7, minY: boundary.minY - 0.7, maxY: boundary.maxY + 0.7 }
      const obstacles = input.obstacles.filter((obstacle: any) => obstacle.center.x + obstacle.width / 2 >= bounds.minX && obstacle.center.x - obstacle.width / 2 <= bounds.maxX && obstacle.center.y + obstacle.height / 2 >= bounds.minY && obstacle.center.y - obstacle.height / 2 <= bounds.maxY)
      const graphics = visualizeSimpleRouteJson({ ...best.outputSrj, bounds, obstacles })
      graphics.rects ??= []
      graphics.rects.push({ center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, fill: "transparent", stroke: "transparent" })
      graphics.texts = [
        { x: bounds.minX, y: bounds.maxY + 0.9, text: `${sample}: ${best.summary.routedConnectionCount}/${input.connections.length} partial escapes; ${drc.checkedViaCount} vias`, fontSize: 0.23, color: "#0f172a", anchorSide: "center_left" },
        { x: bounds.minX, y: bounds.maxY + 0.45, text: `${history.length} assignments; ${(fanoutElapsedMs / 1000).toFixed(1)}s fanout search; ${state.solved ? "fanout solved" : "incomplete"}`, fontSize: 0.2, color: "#475569", anchorSide: "center_left" },
      ]
      writeFileSync(join(output, `${sample}-${mode}.svg`), getSvgFromGraphicsObject(graphics, { backgroundColor: "white", svgWidth: 1000, svgHeight: 1000 }))
    }
    invalid ||= !drc.valid || viaInPad.length > 0
  }
  if (sample === "glider-spaced" && !captures[0].solver && captures[1].args) {
    const [input, options] = captures[1].args
    const boundary = options.sharedBoundary
    const bounds = { minX: boundary.minX - 0.7, maxX: boundary.maxX + 0.7, minY: boundary.minY - 0.7, maxY: boundary.maxY + 0.7 }
    const obstacles = input.obstacles.filter((obstacle: any) => obstacle.center.x + obstacle.width / 2 >= bounds.minX && obstacle.center.x - obstacle.width / 2 <= bounds.maxX && obstacle.center.y + obstacle.height / 2 >= bounds.minY && obstacle.center.y - obstacle.height / 2 <= bounds.maxY)
    // No before fanout SRJ exists. Show only the verified unchanged original
    // pad geometry, using the same native renderer and viewport as the partial.
    const graphics = visualizeSimpleRouteJson({ ...input, bounds, obstacles, connections: [], traces: [] })
    graphics.rects ??= []
    graphics.rects.push({ center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, fill: "transparent", stroke: "transparent" })
    graphics.texts = [
      { x: bounds.minX, y: bounds.maxY + 0.9, text: "glider-spaced: fanout never started", fontSize: 0.23, color: "#0f172a", anchorSide: "center_left" },
      { x: bounds.minX, y: bounds.maxY + 0.45, text: "Original pads; winding placement failed; no fanout copper", fontSize: 0.2, color: "#475569", anchorSide: "center_left" },
    ]
    writeFileSync(join(output, "glider-spaced-before.svg"), getSvgFromGraphicsObject(graphics, { backgroundColor: "white", svgWidth: 1000, svgHeight: 1000 }))
  }
  rows.push(row)
}
const statistics = { baselineRun: 44897719641, candidateRun: 44900830468, unchangedControlsRun: 44899751288, archiveSha256: manifest.archiveSha256, interpretation: "Best diagnostic partial fanout; not committed PCB routing or completed board nets", rows }
writeFileSync(join(output, "shared-capacity-statistics.json"), JSON.stringify(statistics, null, 2))
console.log("SHARED_CAPACITY_PHYSICAL", JSON.stringify(rows.map((row) => ({ sample: row.sample, identicalInputs: row.sameFanoutConstructorInputs, sameCompletedAssignmentPrefix: row.sameCompletedAssignmentPrefix, comparedAssignments: row.comparedAssignments, identicalCompletedOutput: row.identicalCompletedOutput, captures: row.captures.map(({ mode, partialEscapes, requests, nativeVias, fanoutElapsedMs, assignments, nativeDrc, independentViaInPadFindings }: any) => ({ mode, partialEscapes, requests, nativeVias, fanoutElapsedMs, assignments, drcValid: nativeDrc?.valid, viaInPad: independentViaInPadFindings?.length })) }))))
if (invalid) throw new Error("A captured partial fails physical validation; see the saved findings")
