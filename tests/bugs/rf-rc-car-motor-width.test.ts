import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/rf-rc-car-motor-width/rf-rc-car-motor-width.srj.json" with {
  type: "json",
}

test("RF RC car full board reproduces narrowed left-motor routes", async () => {
  const input = structuredClone(srjJson) as SimpleRouteJson
  expect(input.bounds).toEqual({ minX: -37, maxX: 37, minY: -26, maxY: 26 })
  expect(input.layerCount).toBe(2)
  expect(input.obstacles).toHaveLength(63)
  expect(input.connections.map((connection) => connection.name)).toEqual([
    "source_trace_9",
    "source_trace_23",
    "source_trace_24",
    "source_trace_30",
    "source_trace_31",
    "source_trace_32",
    "source_trace_33",
    "source_trace_42",
    "source_trace_43",
    "source_trace_44",
    "source_trace_45",
    "source_net_0",
    "source_net_1",
    "source_net_2",
    "source_net_3",
  ])
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed, `Pipeline9 failed: ${solver.error}`).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  // Preserve the observed bug here; the stacked fix changes these expectations.
  for (const [connectionName, minimumWidth] of [
    ["source_trace_42", 0.15],
    ["source_trace_43", 0.3],
    ["source_trace_44", 1],
    ["source_trace_45", 1],
  ] as const) {
    const connection = input.connections.find(
      (candidate) => candidate.name === connectionName,
    )!
    expect(connection.nominalTraceWidth).toBe(1)
    expect(connection.width).toBe(1)
    const traces = routedTraces.filter(
      (trace) => trace.connection_name === connectionName,
    )
    expect(traces).toHaveLength(1)
    const route = traces[0]!.route
    const widths = route.flatMap((point) =>
      point.route_type === "wire" ? [point.width] : [],
    )
    expect(Math.min(...widths)).toBeCloseTo(minimumWidth, 6)
    expect(Math.max(...widths)).toBe(1)

    let narrowedLength = 0
    for (let index = 1; index < route.length; index++) {
      const previous = route[index - 1]!
      const point = route[index]!
      if (
        previous.route_type === "wire" &&
        point.route_type === "wire" &&
        previous.layer === point.layer &&
        previous.width < 1 - 1e-6 &&
        point.width < 1 - 1e-6
      ) {
        narrowedLength += Math.hypot(point.x - previous.x, point.y - previous.y)
      }
    }
    if (minimumWidth < 1) expect(narrowedLength).toBeGreaterThan(10)
    else expect(narrowedLength).toBe(0)
  }

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
