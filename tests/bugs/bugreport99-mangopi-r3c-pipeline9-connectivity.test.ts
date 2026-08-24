import type { PowerTraceExpanderOptions } from "@tscircuit/power-trace-expander"
import { validateOriginalEndpointConnectivity } from "@tscircuit/fanout-solver"
import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import constructorArgsJson from "../../fixtures/bug-reports/bugreport99-mangopi-r3c-pipeline9-connectivity/bugreport99-mangopi-r3c-pipeline9-connectivity.power-expansion.constructor-args.json" with {
  type: "json",
}
import inputSrjJson from "../../fixtures/bug-reports/bugreport99-mangopi-r3c-pipeline9-connectivity/bugreport99-mangopi-r3c-pipeline9-connectivity.srj.json" with {
  type: "json",
}

type ViaRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "via" }
>

type CapturedViaRoutePoint = ViaRoutePoint & {
  outer_diameter?: number
}

const inputSrj = inputSrjJson as SimpleRouteJson
const [prePowerSrj] = constructorArgsJson as [
  SimpleRouteJson,
  PowerTraceExpanderOptions,
]

function getCapturedViaPadDiameter(
  capturedVia: CapturedViaRoutePoint,
  srj: SimpleRouteJson,
): number {
  return (
    capturedVia.via_diameter ??
    capturedVia.outer_diameter ??
    srj.minViaPadDiameter ??
    srj.min_via_pad_diameter ??
    srj.minViaDiameter ??
    0
  )
}

function normalizeCapturedViaDiameters(srj: SimpleRouteJson): SimpleRouteJson {
  return {
    ...srj,
    traces: (srj.traces ?? []).map((trace) => ({
      ...trace,
      route: trace.route.map((routePoint) => {
        if (routePoint.route_type !== "via") return routePoint
        const capturedVia: CapturedViaRoutePoint = routePoint
        return {
          ...capturedVia,
          via_diameter: getCapturedViaPadDiameter(capturedVia, srj),
        }
      }),
    })),
  }
}

test("bugreport99 captures disconnected MangoPi endpoints before power expansion", () => {
  const inputEndpointCount = inputSrj.connections.reduce(
    (count, connection) => count + connection.pointsToConnect.length,
    0,
  )
  const prePowerTraces = prePowerSrj.traces ?? []
  const prePowerViaCount = prePowerTraces.reduce(
    (count, trace) =>
      count +
      trace.route.filter((routePoint) => routePoint.route_type === "via")
        .length,
    0,
  )
  const inputConnectionNames = inputSrj.connections
    .map((connection) => connection.name)
    .sort()
  const routedConnectionNames = [
    ...new Set(prePowerTraces.map((trace) => trace.connection_name)),
  ].sort()

  expect(inputSrj.connections).toHaveLength(113)
  expect(inputEndpointCount).toBe(518)
  expect(prePowerTraces).toHaveLength(405)
  expect(prePowerViaCount).toBe(519)
  expect(routedConnectionNames).toEqual(inputConnectionNames)

  const connectivity = validateOriginalEndpointConnectivity({
    inputSrj,
    routedSrj: normalizeCapturedViaDiameters(prePowerSrj),
  })
  const disconnectedEndpointCounts = Object.fromEntries(
    connectivity.issues.map((issue) => [
      issue.connectionName,
      issue.disconnectedEndpointIndices.length,
    ]),
  )

  expect(connectivity).toMatchObject({
    valid: false,
    checkedConnectionCount: 113,
    connectedConnectionCount: 107,
    checkedEndpointCount: 518,
    connectedEndpointCount: 502,
  })
  expect(disconnectedEndpointCounts).toEqual({
    source_net_0: 4,
    source_net_1: 4,
    source_net_3: 2,
    source_net_9: 1,
    source_net_36: 3,
    source_net_101: 2,
  })
})
