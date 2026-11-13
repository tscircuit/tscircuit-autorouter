import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import type { SimpleRouteJson } from "lib/types"
import input from "../fixtures/assets/fixed-footprint-diagonal.srj.json"

test("route R1 to R2 around a fixed 45-degree footprint trace", async (): Promise<void> => {
  const srj = structuredClone(input) as SimpleRouteJson
  const fixed = structuredClone(srj.traces![0]!)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces).toHaveLength(2)
  expect(
    output.traces?.find((t) => t.pcb_trace_id === fixed.pcb_trace_id),
  ).toEqual(fixed)
  expect(output.obstacles).toHaveLength(srj.obstacles.length)
  const routed = solver.getOutputSimplifiedPcbTraces()
  expect(routed).toHaveLength(1)
  const route = routed[0]!.route
  expect(route[0]).toMatchObject({ x: -4.49, y: 0, layer: "top" })
  expect(route.at(-1)).toMatchObject({ x: 4.49, y: 0, layer: "top" })
  const [start, end] = fixed.route
  if (start?.route_type !== "wire" || end?.route_type !== "wire") {
    throw new Error("Expected a straight fixed copper segment")
  }
  let minGap = Infinity
  for (const [index, a] of route.entries()) {
    const b = route[index + 1]
    if (a.route_type === "via") {
      const diameter = a.via_diameter ?? srj.minViaDiameter!
      const distance = minimumDistanceBetweenSegments(a, a, start, end)
      minGap = Math.min(minGap, distance - (diameter + start.width) / 2)
    } else if (
      a.route_type === "wire" &&
      b?.route_type === "wire" &&
      a.layer === "top" &&
      b.layer === "top"
    ) {
      const distance = minimumDistanceBetweenSegments(a, b, start, end)
      minGap = Math.min(minGap, distance - (a.width + start.width) / 2)
    }
  }
  expect(Number.isFinite(minGap)).toBe(true)
  expect(minGap).toBeGreaterThanOrEqual(0.1 - 1e-6)

  const drcInput = {
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: routed,
  }
  // Both ends of the standalone input trace are deliberately unconnected.
  const { errors } = evaluateRelaxedDrc(drcInput)
  expect(errors).toHaveLength(2)
  for (const endpoint of ["start", "end"]) {
    expect(errors).toContainEqual(
      expect.objectContaining({
        pcb_trace_error_id: `disconnected_endpoint_${fixed.pcb_trace_id}_${endpoint}`,
      }),
    )
  }
  const svg = getBugReportSnapshotSvg(drcInput)
  await expect(svg.replace(/[ \t]+$/gm, "")).toMatchSvgSnapshot(
    import.meta.path,
  )
})
