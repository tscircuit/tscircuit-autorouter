import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import bugReport from "../../fixtures/bug-reports/bugreport62-0f6ca4/bugreport62-0f6ca4.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport62-0f6ca4.json", () => {
  // This test now pins the exact routed trace signature, so isolate it from
  // shared intra-node cache state left by earlier tests.
  getGlobalInMemoryCache().clearCache()

  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(simplifiedTraces).toHaveLength(12)
  expect(Bun.hash(JSON.stringify(simplifiedTraces)).toString()).toBe(
    "10598740025102347337",
  )
  expect(
    simplifiedTraces.map((trace) => ({
      connectionName: trace.connection_name,
      pointCount: trace.route.length,
      viaCount: trace.route.filter((segment) => segment.route_type === "via")
        .length,
    })),
  ).toEqual([
    { connectionName: "source_trace_11", pointCount: 37, viaCount: 4 },
    { connectionName: "source_trace_10", pointCount: 19, viaCount: 2 },
    { connectionName: "source_trace_9", pointCount: 18, viaCount: 2 },
    { connectionName: "source_trace_8", pointCount: 18, viaCount: 2 },
    { connectionName: "source_trace_7", pointCount: 26, viaCount: 4 },
    { connectionName: "source_trace_6", pointCount: 5, viaCount: 0 },
    { connectionName: "source_trace_5", pointCount: 16, viaCount: 2 },
    { connectionName: "source_trace_4", pointCount: 19, viaCount: 2 },
    { connectionName: "source_trace_3", pointCount: 15, viaCount: 2 },
    { connectionName: "source_trace_2", pointCount: 5, viaCount: 0 },
    { connectionName: "source_trace_1", pointCount: 5, viaCount: 0 },
    { connectionName: "source_trace_0", pointCount: 15, viaCount: 2 },
  ])

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    simplifiedTraces,
    { minTraceWidth: srj.minTraceWidth },
  )
  const { locationAwareErrors } = getDrcErrors(circuitJson)

  expect(locationAwareErrors).toHaveLength(0)
})
