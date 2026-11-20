import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { checkViasInPads } from "@tscircuit/checks"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { getPlanVias } from "../node_modules/@tscircuit/fanout-solver/lib/route-bus/plan-copper"
import { validateRoutedCopperDrc } from "../node_modules/@tscircuit/fanout-solver/lib/validate-routed-copper-drc"
import { visualizeSimpleRouteJson } from "../node_modules/@tscircuit/fanout-solver/lib/visualize-simple-route-json"

const output = process.argv[2]
mkdirSync(output, { recursive: true })
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"))
const readGzip = (path: string) => JSON.parse(gunzipSync(readFileSync(path)).toString())
const statistics = []
const constructorInputs = []
for (const mode of ["before", "after"]) {
  const folder = join(process.cwd(), mode, "icepi-original")
  const report = read(join(folder, "report.json"))
  const solver = report.solvers.find((solver: any) => solver.name === "FanoutSolver")
  const [input, options] = readGzip(join(folder, `solver-${solver.id}-input.json.gz`))
  constructorInputs.push([input, options])
  const state = readGzip(join(folder, `solver-${solver.id}-state.json.gz`))
  const best = state.bestAttempt
  if (!best?.plans?.length) throw new Error("Captured best fanout attempt is missing")
  const circuit = readGzip(join(folder, "circuit.json.gz"))
  const vias = best.plans.flatMap((plan: any, planIndex: number) => getPlanVias(plan).map((via: any, viaIndex: number) => ({ type: "pcb_via", pcb_via_id: `${mode}-${planIndex}-${viaIndex}`, x: via.center.x, y: via.center.y, outer_diameter: via.diameter, hole_diameter: via.holeDiameter, layers: via.spanLayers })))
  const viaInPad = checkViasInPads([...circuit, ...vias])
  const drc = validateRoutedCopperDrc({ inputSrj: input, routedSrj: best.outputSrj, clearance: 0.1, allowBlindAndBuriedVias: false })
  const summary = { mode, sample: "icepi-original", partialFanoutOnly: true, escaped: best.summary.routedConnectionCount, requested: input.connections.length, vias: drc.checkedViaCount, nativeDrcValid: drc.valid, nativeDrcIssues: drc.issues, independentViaInPadFindings: viaInPad, coreTraces: circuit.filter((element: any) => element.type === "pcb_trace").length, coreVias: circuit.filter((element: any) => element.type === "pcb_via").length, revisions: report.revisions }
  statistics.push(summary)
  const boundary = options.sharedBoundary
  const bounds = { minX: boundary.minX - 0.7, maxX: boundary.maxX + 0.7, minY: boundary.minY - 0.7, maxY: boundary.maxY + 0.7 }
  const obstacles = input.obstacles.filter((obstacle: any) => obstacle.center.x + obstacle.width / 2 >= bounds.minX && obstacle.center.x - obstacle.width / 2 <= bounds.maxX && obstacle.center.y + obstacle.height / 2 >= bounds.minY && obstacle.center.y - obstacle.height / 2 <= bounds.maxY)
  const graphics = visualizeSimpleRouteJson({ ...best.outputSrj, bounds, obstacles })
  graphics.texts = [{ x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY + 0.9, text: `iCE/Pi U22: ${summary.escaped}/${summary.requested} partial escapes; ${summary.vias} vias`, fontSize: 0.28, color: "#0f172a", anchorSide: "bottom_center" }, { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY + 0.45, text: `Native copper DRC: ${drc.issues.length} | Independent via-in-pad: ${viaInPad.length}`, fontSize: 0.22, color: "#475569", anchorSide: "bottom_center" }]
  writeFileSync(join(output, `${mode}.svg`), getSvgFromGraphicsObject(graphics, { backgroundColor: "white", svgWidth: 1000, svgHeight: 1000 }))
  writeFileSync(join(output, `${mode}.json`), JSON.stringify(summary, null, 2))
}
if (!isDeepStrictEqual(constructorInputs[0], constructorInputs[1])) {
  throw new Error("Before and after fanout constructor inputs differ")
}
console.log("SOURCE_TURN_INPUTS_IDENTICAL", true)
writeFileSync(join(output, "statistics.json"), JSON.stringify(statistics, null, 2))
console.log("SOURCE_TURN_PHYSICAL", JSON.stringify(statistics))
