import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import report from "./bugreport114-4d61a0.json" with { type: "json" }

const srj = report.simple_route_json as SimpleRouteJson
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj))
solver.solve()
if (!solver.solved || solver.failed) throw new Error(String(solver.error ?? "Routing did not complete"))

// These source nets carry the zero-via crystal constraint in the board TSX.
const crystalNets: Record<string, string> = {
  "source_net_11": "FXP",
  "source_net_12": "FXN"
}
const checked = new Set<string>()
const violations: string[] = []
for (const trace of solver.getOutputSimplifiedPcbTraces()) {
  const net = crystalNets[trace.connection_name]
  if (!net) continue
  checked.add(net)
  const vias = trace.route.filter((point) => point.route_type === "via").length
  if (vias) violations.push(`${net} (${trace.pcb_trace_id}): ${vias} vias, maximum 0`)
  if (net === "FXN") {
    let length = 0
    for (let i = 1; i < trace.route.length; i++) {
      const a = trace.route[i - 1]
      const b = trace.route[i]
      if (a.route_type === "wire" && b.route_type === "wire" && a.layer === b.layer) {
        length += Math.hypot(b.x - a.x, b.y - a.y)
      }
    }
    if (length > 10) violations.push(`FXN (${trace.pcb_trace_id}): ${length.toFixed(2)} mm, maximum 10 mm`)
  }
}
if (checked.size !== Object.keys(crystalNets).length) throw new Error("Missing crystal routes")
if (violations.length) throw new Error(violations.join("\n"))
