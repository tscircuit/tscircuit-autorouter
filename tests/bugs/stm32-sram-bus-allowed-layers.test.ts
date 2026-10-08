import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import input from "../fixtures/bug-reports/stm32-sram-bus-allowed-layers/input.json"

test("keeps the STM32 SRAM control bus on its allowed copper layers", async () => {
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

  const bus = srj.buses!.find((bus) => bus.busId === "CONTROL")!
  expect(bus.allowedLayers).toEqual(["top", "bottom"])
  expect(bus.connectionNames).toHaveLength(5)
  const forbiddenSegments = traces.flatMap((trace) => {
    const belongsToBus = bus.connectionNames.some(
      (name) =>
        trace.connection_name === name ||
        trace.connection_name.startsWith(`${name}_`),
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
      if (Math.hypot(next.x - point.x, next.y - point.y) < 1e-6) return []
      if (bus.allowedLayers!.includes(point.layer)) return []
      return [{ connection: trace.connection_name, layer: point.layer }]
    })
  })
  expect(forbiddenSegments).toEqual([])
})
