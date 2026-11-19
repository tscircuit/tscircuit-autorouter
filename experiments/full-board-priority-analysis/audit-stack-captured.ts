import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { validateNativeRequestConstraints } from "./validate-native-request-constraints"
import { validateRoutedCopperDrc } from "./lib/validate-routed-copper-drc"

const [inputPath, routedPath, reportPath] = process.argv.slice(2)
const serializedInput = gunzipSync(readFileSync(inputPath)).toString()
const captured = JSON.parse(serializedInput)
const routed = JSON.parse(gunzipSync(readFileSync(routedPath)).toString())
const traces = routed.traces
if (!Array.isArray(traces)) throw new Error("Captured fanout has no trace array")
const copperDrc = validateRoutedCopperDrc({
  inputSrj: captured.solverParams,
  routedSrj: routed,
  clearance: captured.solverParams.minViaEdgeToPadEdgeClearance,
  allowBlindAndBuriedVias: false,
})
const requestConstraints = validateNativeRequestConstraints({
  inputSrj: captured.solverParams,
  solverOptions: captured.solverOptions,
  traces,
})
const connectionNames = [...new Set(traces.map((trace) => trace.connection_name))]
const distinctDrills = new Set(traces.flatMap((trace) =>
  trace.route.filter((point) => point.route_type === "via").map((via) =>
    JSON.stringify([Math.round(via.x * 1e9), Math.round(via.y * 1e9)]),
  ),
)).size
const report = {
  inputSha256: createHash("sha256").update(serializedInput).digest("hex"),
  copperDrc,
  requestConstraints,
  routedRequests: connectionNames.length,
  connectionNames,
  distinctDrills,
}
writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log("REVIEWED_CAPTURE_AUDIT", JSON.stringify(report))
if (!copperDrc.valid || !requestConstraints.valid)
  throw new Error("Captured partial fanout violates physical request constraints")
