import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { gunzipSync } from "node:zlib"
import { checkViasInPads } from "@tscircuit/checks"
import { FanoutSolver } from "../node_modules/@tscircuit/fanout-solver/lib/fanout-solver"
import { getPlanVias } from "../node_modules/@tscircuit/fanout-solver/lib/route-bus/plan-copper"
import { validateRoutedCopperDrc } from "../node_modules/@tscircuit/fanout-solver/lib/validate-routed-copper-drc"

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
    return { mode, folder, report, solver, args: solver ? readGzip(join(folder, `solver-${solver.id}-input.json.gz`)) : null }
  })
  const sameInputs = isDeepStrictEqual(captures[0].args, captures[1].args)
  if (!sameInputs) throw new Error(`Captured before/after inputs differ for ${sample}`)
  const row = { sample, sameFanoutConstructorInputs: sameInputs, captures: [] as any[] }
  for (const { mode, folder, report, solver: summary, args } of captures) {
    if (!summary) {
      row.captures.push({ mode, fanoutReached: false, errors: report.errors })
      continue
    }
    const [input, options] = args
    const solver = new FanoutSolver(input, options)
    const state = readGzip(join(folder, `solver-${summary.id}-state.json.gz`))
    const best = state.bestAttempt
    if (!best) throw new Error(`Best partial state missing for ${sample}`)
    const circuitFilename = existsSync(join(folder, "circuit.json.gz")) ? "circuit.json.gz" : "unrouted.circuit.json.gz"
    const circuit = readGzip(join(folder, circuitFilename))
    const vias = best.plans.flatMap((plan: any, planIndex: number) => getPlanVias(plan).map((via: any, viaIndex: number) => ({ type: "pcb_via", pcb_via_id: `diagnostic-${mode}-${planIndex}-${viaIndex}`, x: via.center.x, y: via.center.y, outer_diameter: via.diameter, hole_diameter: via.holeDiameter ?? solver.config.viaHoleDiameter, layers: via.spanLayers })))
    const viaInPad = checkViasInPads([...circuit, ...vias])
    const drc = validateRoutedCopperDrc({ inputSrj: input, routedSrj: best.outputSrj, clearance: solver.config.clearance, allowBlindAndBuriedVias: solver.config.allowBlindAndBuriedVias })
    const assessmentFilename = join(folder, "assessment.json")
    const assessment = existsSync(assessmentFilename) ? read(assessmentFilename) : null
    row.captures.push({ mode, fanoutReached: true, solved: state.solved, failed: state.failed, partialEscapes: best.summary.routedConnectionCount, requests: input.connections.length, fanoutElapsedMs: report.phases.find((phase: any) => phase.solver === 'FanoutSolver')?.elapsedMs, assignments: read(join(folder, 'pipeline-internals.json')).completedAssignments.length, nativeVias: drc.checkedViaCount, physicalViaSites: new Set(vias.map((via: any) => JSON.stringify([via.x, via.y, via.outer_diameter, via.hole_diameter, via.layers]))).size, nativeDrc: drc, independentViaInPadFindings: viaInPad, checkedCircuitSnapshot: circuitFilename, coreTraces: circuit.filter((element: any) => element.type === "pcb_trace").length, coreVias: circuit.filter((element: any) => element.type === "pcb_via").length, preservedGeometry: assessment ? { components: assessment.components, expectedComponents: assessment.expectedComponents, pads: assessment.pads, expectedPads: assessment.expectedPads, membershipErrors: assessment.membershipErrors } : null, revisions: report.revisions })
    invalid ||= !drc.valid || viaInPad.length > 0
  }
  rows.push(row)
}
const statistics = { baselineRun: 44819438953, candidateRun: 44821265233, archiveSha256: manifest.archiveSha256, interpretation: "Best diagnostic partial fanout; not committed PCB routing or completed board nets", rows }
writeFileSync(join(output, "prune-layer-final-statistics.json"), JSON.stringify(statistics, null, 2))
console.log("PRUNE_LAYER_PHYSICAL", JSON.stringify(rows.map((row) => ({ sample: row.sample, identicalInputs: row.sameFanoutConstructorInputs, captures: row.captures.map(({ mode, partialEscapes, requests, nativeVias, physicalViaSites, nativeDrc, independentViaInPadFindings }: any) => ({ mode, partialEscapes, requests, nativeVias, physicalViaSites, drcValid: nativeDrc?.valid, viaInPad: independentViaInPadFindings?.length })) }))))
if (invalid) throw new Error("A captured partial fails physical validation; see the saved findings")
