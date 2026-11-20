import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { FanoutSolver } from "../../core/node_modules/@tscircuit/fanout-solver/lib/fanout-solver"
import { validateRoutedCopperDrc } from "../../core/node_modules/@tscircuit/fanout-solver/lib/validate-routed-copper-drc"

const folder = process.argv[2]!
const report = JSON.parse(readFileSync(join(folder, "report.json"), "utf8"))
const captures = readdirSync(folder)
const inputs = captures.filter((name) => name.startsWith("started-") && name.endsWith("-FanoutSolver.json.gz")).sort()
const diagnostics = []
let inputIndex = 0
for (const entry of report.solvers) {
  if (entry.name !== "FanoutSolver") continue
  const input = JSON.parse(gunzipSync(readFileSync(join(folder, inputs[inputIndex++]!))).toString())
  const state = JSON.parse(gunzipSync(readFileSync(join(folder, `solver-${entry.id}-state.json.gz`))).toString())
  const best = state.bestAttempt
  const solver = new FanoutSolver(input.args[0], input.args[1])
  if (!best) {
    diagnostics.push({ component: input.component, requested: input.args[0].connections.length, available: false })
    continue
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: input.args[0],
    routedSrj: best.outputSrj,
    clearance: solver.config.clearance,
    allowBlindAndBuriedVias: solver.config.allowBlindAndBuriedVias,
  })
  diagnostics.push({
    component: input.component,
    requested: input.args[0].connections.length,
    available: true,
    routed: best.summary.routedConnectionCount,
    vias: drc.checkedViaCount,
    drcValid: drc.valid,
    drcIssues: drc.issues,
    solved: state.solved,
    failed: state.failed,
    latestStage: state.stage,
    routedConnections: (best.outputSrj.traces ?? []).map((trace: { connection_name: string }) => trace.connection_name),
  })
}
writeFileSync(join(folder, "diagnostics.json"), JSON.stringify(diagnostics, null, 2) + "\n")
