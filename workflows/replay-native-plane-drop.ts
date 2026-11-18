import { FanoutSolver } from "./lib/index"
import type { SimpleRouteJson } from "@tscircuit/capacity-autorouter"
import type { FanoutRoutePlan } from "./lib/types"
import { validateRoutedCopperDrc } from "./lib/validate-routed-copper-drc"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

const [inputPath, output] = process.argv.slice(2)
mkdirSync(output, { recursive: true })
const serialized = gunzipSync(new Uint8Array(readFileSync(inputPath))).toString()
const captured = JSON.parse(serialized)
const started = performance.now()
const solver = new FanoutSolver(captured.solverParams, captured.solverOptions)
while (!solver.solved && !solver.failed) {
  if (performance.now() - started > 900_000) throw new Error("Native fanout diagnostic exceeded 15 minutes")
  solver.step()
}
const elapsedMs = performance.now() - started
// Diagnostic access only: unsuccessful whole fanouts expose no public output.
const bestAttempt: {
  plans: FanoutRoutePlan[]
  outputSrj: SimpleRouteJson
} | null = Reflect.get(solver, "bestAttempt")
if (!bestAttempt) throw new Error("Native fanout produced no assignment attempt")
const copperDrc = validateRoutedCopperDrc({
  inputSrj: captured.solverParams,
  routedSrj: bestAttempt.outputSrj,
  clearance: captured.solverParams.minViaEdgeToPadEdgeClearance,
  allowBlindAndBuriedVias: false,
})
const graphics = solver.visualize()
const report = {
  inputSha256: createHash("sha256").update(serialized).digest("hex"),
  elapsedMs,
  copperDrc,
  bestPartial: {
    routed: bestAttempt.plans.length,
    planes: bestAttempt.plans.filter((plan) => plan.termination.type === "plane").length,
    boundary: bestAttempt.plans.filter((plan) => plan.termination.type === "boundary").length,
    vias: bestAttempt.plans.reduce((total, plan) => total + (plan.via ? 1 : 0) + (plan.additionalVias?.length ?? 0) + (plan.planeEndpointVia ? 1 : 0), 0),
    connectionNames: bestAttempt.plans.map((plan) => plan.connectionName),
    planeBuses: bestAttempt.plans.filter((plan) => plan.termination.type === "plane").map((plan) => plan.busId),
  },
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  iterations: solver.iterations,
  stats: solver.stats,
  options: captured.solverOptions,
  inputConnections: captured.solverParams.connections.length,
}
writeFileSync(`${output}/best-traces.json`, JSON.stringify(bestAttempt.plans.flatMap((plan) => [plan.trace, ...(plan.planeEndpointTrace ? [plan.planeEndpointTrace] : [])]), null, 2))
writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2))
writeFileSync(`${output}/fanout.graphics.json`, JSON.stringify(graphics))
writeFileSync(`${output}/fanout.svg`, getSvgFromGraphicsObject(graphics, { backgroundColor: "white", svgWidth: 1400, svgHeight: 1100 }))
console.log("NATIVE_PLANE_DROP_RESULT", JSON.stringify(report))

if (!copperDrc.valid) throw new Error("Native best partial fanout failed copper DRC")
