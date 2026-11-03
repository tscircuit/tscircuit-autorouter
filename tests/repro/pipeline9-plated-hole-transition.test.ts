import { beforeAll, expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import input from "./assets/core-plated-hole-transition.json"

// Captured from core's repro-wide-trace-obstacle-snapshot circuit.
const inputSrj: SimpleRouteJson = structuredClone(input)
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj)

beforeAll(async (): Promise<void> => {
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})

test("plated-hole transitions stay inside their pads", (): void => {
  const trace = solver
    .getOutputSimplifiedPcbTraces()
    .find(
      (trace) => trace.pcb_trace_id === "source_trace_1__source_trace_3_mst0_0",
    )!
  const transition = trace.route.find(
    (point) => point.route_type === "through_obstacle",
  )!
  expect(transition).toBeDefined()
  const pad = inputSrj.obstacles.find(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.pcb_plated_hole_id === "pcb_plated_hole_1",
  )!
  for (const endpoint of [transition.start, transition.end]) {
    const distance = Math.hypot(
      endpoint.x - pad.center.x,
      endpoint.y - pad.center.y,
    )
    expect(distance).toBeLessThanOrEqual(pad.width / 2)
  }
})
