import { expect, test } from "bun:test"
import boardPhase from "../../fixtures/bug-reports/am62l-hdmi-bus-constraints/am62l-hdmi-clock-pair.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

const CLOCK_PAIR_CONNECTIONS = ["source_trace_30", "source_trace_31"]

const getTraceLength = (trace: SimplifiedPcbTrace): number => {
  const points = trace.route.flatMap((routePoint) =>
    routePoint.route_type === "wire" || routePoint.route_type === "via"
      ? [{ x: routePoint.x, y: routePoint.y }]
      : [],
  )
  return points.slice(1).reduce((length, point, pointIndex) => {
    const previousPoint = points[pointIndex]!
    return (
      length + Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y)
    )
  }, 0)
}

// Pipeline 9 currently omits bus length matching.
test.failing(
  "AM62L HDMI clock pair stays within its maximum length skew",
  (): void => {
    const inputSrj = structuredClone(boardPhase) as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      inputSrj,
      {
        cacheProvider: null,
        visualizationTraceColorMode: "net",
      },
    )

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const clockBus = inputSrj.buses?.find((bus) =>
      CLOCK_PAIR_CONNECTIONS.every((connectionName) =>
        bus.connectionNames.includes(connectionName),
      ),
    )
    if (clockBus?.maxLengthSkew === undefined) {
      throw new Error("Expected the TMDS clock pair to declare maximum skew")
    }
    expect(clockBus.maxLengthSkew).toBe(0.5)

    const routedTraces = solver.getOutputSimplifiedPcbTraces()
    const routedLengths = CLOCK_PAIR_CONNECTIONS.map((connectionName) =>
      routedTraces
        .filter((trace) => trace.connection_name === connectionName)
        .reduce((length, trace) => length + getTraceLength(trace), 0),
    )
    const routedSkew = Math.abs(routedLengths[0]! - routedLengths[1]!)

    // source_trace_30 is U5.TXC_POS -> U6.CLK_POS -> J2.pin10.
    // source_trace_31 is U5.TXC_NEG -> U6.CLK_NEG -> J2.pin12.
    expect(routedSkew).toBeLessThanOrEqual(clockBus.maxLengthSkew)
  },
)
