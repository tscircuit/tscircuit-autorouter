import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import inputFixture from "./assets/pipeline9-bga36-phase2.json"

test("Pipeline9 simplifies BGA phase-two approaches without avoiding their own fanout", async (): Promise<void> => {
  // Exact phase-two SRJ from core's breakout-bga36-decoupling-caps test.
  const input = structuredClone(inputFixture) as SimpleRouteJson
  const preloadedTraces = structuredClone(input.traces!)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const output = solver.getOutputSimpleRouteJson()
  expect(routedTraces).toHaveLength(8)
  expect(output.traces).toHaveLength(16)
  for (const preloadedTrace of preloadedTraces) {
    expect(
      output.traces!.find(
        (trace) => trace.pcb_trace_id === preloadedTrace.pcb_trace_id,
      ),
    ).toEqual(preloadedTrace)
  }

  for (const trace of routedTraces) {
    // Four straight approaches and four single 45-degree bends, no wrinkles.
    expect(trace.route.length).toBeGreaterThanOrEqual(2)
    expect(trace.route.length).toBeLessThanOrEqual(3)
    expect(trace.route.every((point) => point.route_type === "wire")).toBe(true)
    const connection = input.connections.find(
      (connection) => connection.name === trace.connection_name,
    )!
    for (const terminal of connection.pointsToConnect) {
      expect([trace.route[0], trace.route.at(-1)]).toContainEqual(
        expect.objectContaining({ x: terminal.x, y: terminal.y }),
      )
    }
  }
  expect(routedTraces.filter((trace) => trace.route.length === 2)).toHaveLength(
    4,
  )

  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  expect(evaluateRelaxedDrc(snapshotInput).errors).toEqual([])
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
