import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { gunzipSync } from "node:zlib"
import { checkViasInPads } from "@tscircuit/checks"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { FanoutSolver } from "../node_modules/@tscircuit/fanout-solver/lib/fanout-solver"
import { getPlanVias } from "../node_modules/@tscircuit/fanout-solver/lib/route-bus/plan-copper"
import { validateRoutedCopperDrc } from "../node_modules/@tscircuit/fanout-solver/lib/validate-routed-copper-drc"
import { visualizeSimpleRouteJson } from "../node_modules/@tscircuit/fanout-solver/lib/visualize-simple-route-json"

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"))
const readGzip = (path: string) => JSON.parse(gunzipSync(readFileSync(path)).toString())
const manifest = read("inputs.json")
const output = "verified"
mkdirSync(output, { recursive: true })
const rows = []
for (const entry of manifest.samples) {
  const sample = entry.name.replace(/\.tsx$/, "")
  const captures = ["before", "after"].map((mode) => {
    const folder = join(mode, `full-circuit-interception-${sample}`, sample)
    const report = read(join(folder, "report.json"))
    const summary = report.solvers.find((solver) => solver.name === "FanoutSolver")
    if (!summary) throw new Error(`Fanout capture missing: ${sample}/${mode}`)
    const args = readGzip(join(folder, `solver-${summary.id}-input.json.gz`))
    const state = readGzip(join(folder, `solver-${summary.id}-state.json.gz`))
    const history = read(join(folder, "pipeline-internals.json")).completedAssignments
    const circuit = readGzip(join(folder, "circuit.json.gz"))
    const assessment = read(join(folder, "assessment.json"))
    if (report.initialCopper !== 0) throw new Error(`Original routes found: ${sample}`)
    if (assessment.components !== assessment.expectedComponents ||
        assessment.pads !== assessment.expectedPads || assessment.membershipErrors.length) {
      throw new Error(`Geometry or membership mismatch: ${sample}/${mode}`)
    }
    return { mode, folder, report, args, state, history, circuit, assessment }
  })
  const [before, after] = captures
  const sameInputs = isDeepStrictEqual(before.args, after.args)
  if (!sameInputs) throw new Error(`Fanout constructor changed: ${sample}`)
  const comparedAssignments = Math.min(before.history.length, after.history.length)
  const sameHistory = isDeepStrictEqual(
    before.history.slice(0, comparedAssignments),
    after.history.slice(0, comparedAssignments),
  )
  if (!sameHistory) throw new Error(`Search decisions changed: ${sample}`)
  const padGeometry = captures.map(({ circuit }) =>
    circuit.filter((element) => ["pcb_smtpad", "pcb_plated_hole", "pcb_hole"].includes(element.type)),
  )
  if (!isDeepStrictEqual(...padGeometry)) throw new Error(`Physical pads changed: ${sample}`)
  const completeSearches = captures.every(({ state }) => state.solved || state.failed)
  const identicalCompletedOutput = completeSearches
    ? isDeepStrictEqual(before.state.bestAttempt.outputSrj, after.state.bestAttempt.outputSrj)
    : null
  if (identicalCompletedOutput === false) throw new Error(`Completed output changed: ${sample}`)
  const identicalPcbSvg = readFileSync(join(before.folder, "pcb.svg"))
    .equals(readFileSync(join(after.folder, "pcb.svg")))
  const row = { sample, sameInputs, sameHistory, comparedAssignments,
    samePadGeometry: true, identicalCompletedOutput, identicalPcbSvg, captures: [] }
  for (const capture of captures) {
    const { mode, args, state, history, circuit, report, assessment } = capture
    const [input, options] = args
    const solver = new FanoutSolver(input, options)
    const best = state.bestAttempt
    const drc = validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: best.outputSrj,
      clearance: solver.config.clearance,
      allowBlindAndBuriedVias: solver.config.allowBlindAndBuriedVias,
    })
    const vias = best.plans.flatMap((plan, planIndex) => getPlanVias(plan).map((via, viaIndex) => ({
      type: "pcb_via", pcb_via_id: `diagnostic-${mode}-${planIndex}-${viaIndex}`,
      x: via.center.x, y: via.center.y, outer_diameter: via.diameter,
      hole_diameter: via.holeDiameter ?? solver.config.viaHoleDiameter, layers: via.spanLayers,
    })))
    const viaInPad = checkViasInPads([...circuit, ...vias])
    if (!drc.valid || viaInPad.length) throw new Error(`Physical DRC failed: ${sample}/${mode}`)
    row.captures.push({
      mode, reportStatus: report.status, solved: state.solved, failed: state.failed,
      partialEscapes: best.summary.routedConnectionCount, requested: input.connections.length,
      assignments: history.length, vias: drc.checkedViaCount, nativeDrc: drc,
      independentViaInPadFindings: viaInPad.length, assessment,
      windingCalls: report.solvers.filter((entry) => entry.name === "WindingBreakoutSolver").length,
      windingSolved: report.solvers.filter((entry) => entry.name === "WindingBreakoutSolver" && entry.solved).length,
      committedTraces: circuit.filter((element) => element.type === "pcb_trace").length,
      committedVias: circuit.filter((element) => element.type === "pcb_via").length,
      revisions: report.revisions,
    })
    if (sample === "icepi-original" || sample === "butterstick-original") {
      const boundary = options.sharedBoundary
      const bounds = { minX: boundary.minX - 0.7, maxX: boundary.maxX + 0.7,
        minY: boundary.minY - 0.7, maxY: boundary.maxY + 0.7 }
      const obstacles = input.obstacles.filter((obstacle) =>
        obstacle.center.x + obstacle.width / 2 >= bounds.minX &&
        obstacle.center.x - obstacle.width / 2 <= bounds.maxX &&
        obstacle.center.y + obstacle.height / 2 >= bounds.minY &&
        obstacle.center.y - obstacle.height / 2 <= bounds.maxY)
      const graphics = visualizeSimpleRouteJson({
        ...best.outputSrj, bounds, obstacles, connections: [],
      })
      graphics.rects ??= []
      graphics.rects.push({
        center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
        width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY,
        fill: "transparent", stroke: "transparent",
      })
      graphics.texts = [
        { x: bounds.minX, y: bounds.maxY + 2,
          text: `${sample}: ${best.plans.length}/${input.connections.length} partial escapes; ${drc.checkedViaCount} vias`,
          fontSize: 0.23, color: "#0f172a", anchorSide: "center_left" },
        { x: bounds.minX, y: bounds.maxY + 1.5,
          text: "Diagnostic partial fanout; full board incomplete",
          fontSize: 0.2, color: "#475569", anchorSide: "center_left" },
      ]
      writeFileSync(join(output, `${sample}-${mode}.svg`), getSvgFromGraphicsObject(graphics, {
        backgroundColor: "white", svgWidth: 1000, svgHeight: 1000,
      }))
    }
  }
  rows.push(row)
}
writeFileSync(join(output, "statistics.json"), JSON.stringify({ rows }, null, 2))
console.log("BOUNDARY_CACHE_PHYSICAL", JSON.stringify(rows.map((row) => ({
  sample: row.sample, sameInputs: row.sameInputs, sameHistory: row.sameHistory,
  comparedAssignments: row.comparedAssignments, identicalPcbSvg: row.identicalPcbSvg,
  identicalCompletedOutput: row.identicalCompletedOutput,
  captures: row.captures.map(({ mode, partialEscapes, requested, assignments, vias,
    independentViaInPadFindings, nativeDrc }) => ({
      mode, partialEscapes, requested, assignments, vias,
      independentViaInPadFindings, drcValid: nativeDrc.valid,
    })),
}))))
