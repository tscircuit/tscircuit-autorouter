import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import input from "../fixtures/bug-reports/stm32-sram-bus-allowed-layers/input.json"

const MIN_LATERAL_SEGMENT_LENGTH = 1e-6

test("reproduces STM32 SRAM control copper on forbidden layers", async () => {
  const srj = structuredClone(input) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)

  expect(srj.layerCount).toBe(4)
  expect(srj.buses).toHaveLength(1)
  expect(traces.length).toBeGreaterThan(0)
  const bus = srj.buses![0]!
  expect(bus.allowedLayers).toEqual(["top", "bottom"])
  expect(bus.connectionNames).toHaveLength(5)
  const forbiddenSegments = traces.flatMap((trace) => {
    const belongsToBus = bus.connectionNames.some((name) =>
      solver.connMap.areIdsConnected(name, trace.connection_name),
    )
    if (!belongsToBus) return []
    return trace.route.flatMap((point, index) => {
      const next = trace.route[index + 1]
      if (
        point.route_type !== "wire" ||
        !next ||
        (next.route_type !== "wire" && next.route_type !== "via")
      )
        return []
      if (
        Math.hypot(next.x - point.x, next.y - point.y) <
        MIN_LATERAL_SEGMENT_LENGTH
      )
        return []
      if (bus.allowedLayers!.includes(point.layer)) return []
      return [{ connection: trace.connection_name, layer: point.layer }]
    })
  })
  expect(forbiddenSegments).toHaveLength(24)
})
