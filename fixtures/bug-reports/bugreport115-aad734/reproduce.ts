import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import report from "./bugreport115-aad734.json" with { type: "json" }

const srj = report.simple_route_json as SimpleRouteJson
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj))
solver.solve()
if (!solver.solved || solver.failed) throw new Error(String(solver.error ?? "Routing did not complete"))

const { minX, maxX, minY, maxY } = srj.bounds
const violations: string[] = []
for (const trace of solver.getOutputSimplifiedPcbTraces()) {
  for (const point of trace.route) {
    if (point.route_type !== "via") continue
    const radius = (point.via_diameter ?? srj.minViaPadDiameter!) / 2
    const edge = Math.min(point.x - minX, maxX - point.x, point.y - minY, maxY - point.y) - radius
    if (edge + 1e-6 < srj.minBoardEdgeClearance!) {
      violations.push(`Via at (${point.x}, ${point.y}): ${edge.toFixed(3)} mm, minimum ${srj.minBoardEdgeClearance} mm`)
    }
  }
}
if (violations.length) throw new Error(violations.join("\n"))
