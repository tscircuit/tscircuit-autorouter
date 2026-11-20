import { appendFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import { gzipSync } from "node:zlib"
import { FanoutSolver } from "./lib/fanout-solver"
import { validateRoutedCopperDrc } from "./lib/validate-routed-copper-drc"

const getOutput = FanoutSolver.prototype.getOutput
FanoutSolver.prototype.getOutput = function () {
  const output = getOutput.call(this)
  const drc = validateRoutedCopperDrc({ inputSrj: this.inputSrj, routedSrj: output.simpleRouteJson, clearance: this.config.clearance, allowBlindAndBuriedVias: this.config.allowBlindAndBuriedVias })
  const test = basename(process.env.E2E_TEST!)
  let wireLengthMm = 0
  for (const trace of output.simpleRouteJson.traces ?? []) {
    for (let index = 1; index < trace.route.length; index++) {
      const previous = trace.route[index - 1]!
      const point = trace.route[index]!
      if (previous.route_type === "wire" && point.route_type === "wire" && previous.layer === point.layer) wireLengthMm += Math.hypot(point.x - previous.x, point.y - previous.y)
    }
  }
  const summary = { test, connections: output.validation.brokenOutConnectionCount, traces: drc.checkedTraceCount, vias: drc.checkedViaCount, wireLengthMm, drc }
  appendFileSync("source-turn-regressions.ndjson", JSON.stringify(summary) + "\n")
  writeFileSync(`source-turn-${test}.json.gz`, gzipSync(JSON.stringify({ input: this.inputSrj, options: this.options, output })))
  console.log("SOURCE_TURN_REGRESSION", JSON.stringify(summary))
  return output
}
