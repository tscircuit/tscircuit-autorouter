import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver8 } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport59-82431e/bugreport59-82431e.json" with {
  type: "json",
}
import type {
  ConnectionPoint,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { getAssignableViaPointKeys } from "lib/autorouter-pipelines/AutoroutingPipeline8/assignableViaUtils"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"

const srj = bugReport.simple_route_json as SimpleRouteJson

type RouteEndpoint = { x: number; y: number }

const getTraceEndpoint = (
  trace: SimplifiedPcbTrace,
  side: "start" | "end",
): RouteEndpoint => {
  const segment =
    side === "start" ? trace.route[0] : trace.route[trace.route.length - 1]
  if (!segment) throw new Error(`Trace ${trace.connection_name} has no route`)
  if (segment.route_type === "jumper") {
    return side === "start" ? segment.start : segment.end
  }
  if (segment.route_type === "through_obstacle") {
    return side === "start" ? segment.start : segment.end
  }
  return { x: segment.x, y: segment.y }
}

const expectTraceToConnectPoints = (
  trace: SimplifiedPcbTrace,
  pointA: ConnectionPoint,
  pointB: ConnectionPoint,
) => {
  const traceStart = getTraceEndpoint(trace, "start")
  const traceEnd = getTraceEndpoint(trace, "end")
  const directDistance =
    Math.hypot(traceStart.x - pointA.x, traceStart.y - pointA.y) +
    Math.hypot(traceEnd.x - pointB.x, traceEnd.y - pointB.y)
  const swappedDistance =
    Math.hypot(traceStart.x - pointB.x, traceStart.y - pointB.y) +
    Math.hypot(traceEnd.x - pointA.x, traceEnd.y - pointA.y)
  expect(Math.min(directDistance, swappedDistance)).toBeLessThan(1e-3)
}

test("bugreport59-82431e.json", () => {
  const solver = new AutoroutingPipelineSolver8(srj)
  solver.solve()
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  const outputTracesByConnection = new Map(
    solver
      .getOutputSimplifiedPcbTraces()
      .map((trace) => [trace.connection_name, trace]),
  )

  for (const connectionName of ["source_trace_7", "source_trace_8"]) {
    const connection = srj.connections.find((c) => c.name === connectionName)
    const trace = outputTracesByConnection.get(connectionName)
    expect(connection).toBeDefined()
    expect(trace).toBeDefined()
    expectTraceToConnectPoints(
      trace!,
      connection!.pointsToConnect[0]!,
      connection!.pointsToConnect[1]!,
    )
  }

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
}, 30_000)

test("bugreport59-82431e keeps effort 2 vias on preplaced assignable vias", () => {
  const solver = new AutoroutingPipelineSolver8(srj, { effort: 2 })
  solver.solve()

  const allowedViaPointKeys = getAssignableViaPointKeys(srj.obstacles)
  const outputVias = solver
    .getOutputSimplifiedPcbTraces()
    .flatMap((trace) =>
      trace.route.filter((segment) => segment.route_type === "via"),
    )

  expect(outputVias.length).toBeGreaterThan(0)
  expect(
    outputVias.filter((via) => !allowedViaPointKeys.has(getXyPointKey(via))),
  ).toEqual([])
}, 30_000)
