import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import inputJson from "./bugreport106-pipeline9-qspi-via-pad-overlap.srj.json"

const input = inputJson as SimpleRouteJson
let traces: SimplifiedPcbTraces

if (process.argv.includes("--observed")) {
  traces = JSON.parse(
    readFileSync(new URL("./observed.traces.json", import.meta.url), "utf8"),
  ) as SimplifiedPcbTraces
} else {
  const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import("lib")
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
  )
  solver.solve()
  console.log({ solved: solver.solved, failed: solver.failed, error: solver.error })
  assert.equal(solver.failed, false, "The reported reproduction completed routing")
  assert.equal(solver.solved, true, "The reported reproduction returned solved")
  traces = solver.getOutputSimplifiedPcbTraces()
}

// Check the reported QSPI signal against the unrelated top-layer SCLK pad.
// This circle-to-rectangle check is independent of the tscircuit DRC checker.
const pad = input.obstacles.find(
  (obstacle) => obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_87",
)
assert(pad, "Missing reported QSPI_SCLK pad")
assert.equal(pad.type, "rect")
assert(pad.layers.includes("top"))
assert(pad.connectedTo.includes("source_trace_34"))
assert(!pad.connectedTo.includes("source_trace_30"))
const requiredClearance = input.minViaEdgeToPadEdgeClearance
assert.equal(requiredClearance, 0.25)
assert.equal(input.minViaPadDiameter, 0.45)
assert(requiredClearance !== undefined)

const signalTraces = traces.filter(
  (trace) => trace.connection_name === "source_trace_30",
)
assert(signalTraces.length > 0, "Missing reported QSPI signal trace")
const violations = []
for (const trace of signalTraces) {
  for (const via of trace.route) {
    if (
      via.route_type !== "via" ||
      (via.from_layer !== "top" && via.to_layer !== "top")
    ) {
      continue
    }
    const diameter = via.via_diameter ?? input.minViaPadDiameter
    assert(diameter !== undefined)
    const dx = Math.max(Math.abs(via.x - pad.center.x) - pad.width / 2, 0)
    const dy = Math.max(Math.abs(via.y - pad.center.y) - pad.height / 2, 0)
    const gap = Math.hypot(dx, dy) - diameter / 2
    if (gap < requiredClearance - 1e-9) {
      violations.push({
        trace: trace.connection_name,
        via,
        pad: pad.circuitJsonMetadata,
        gap,
        required: requiredClearance,
      })
    }
  }
}
console.log(JSON.stringify(violations, null, 2))
assert.equal(
  violations.length,
  0,
  "Router output violates via-to-unrelated-pad clearance (negative gap means copper overlap)",
)
