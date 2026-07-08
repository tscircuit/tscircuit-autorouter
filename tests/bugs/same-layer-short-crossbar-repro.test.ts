import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

// Minimal reproduction for #1507 / #1513: on a dense board the pipeline models a
// same-layer crossing as via-resolvable *cost* (see
// calculateCrossingProbabilityOfFailure), not a hard constraint, so when the
// high-density stage cannot actually resolve one it survives to the output as a
// different-net same-layer overlap - a real short that getDrcErrors flags.
//
// Crossbar: N nets whose endpoints are reversed left<->right, all starting on the
// top layer, packed into a small 2-layer area so every net must cross every other.
// That saturates the via budget and forces at least one unresolved same-layer
// crossing into the routed output.
const buildCrossbarSrj = (
  n: number,
  pitch: number,
  xSpan: number,
): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.15,
  bounds: { minX: -1, maxX: xSpan + 1, minY: -1, maxY: (n - 1) * pitch + 1 },
  obstacles: [],
  connections: Array.from({ length: n }, (_, i) => ({
    name: `net${i}`,
    pointsToConnect: [
      { x: 0, y: i * pitch, layer: "top" },
      { x: xSpan, y: (n - 1 - i) * pitch, layer: "top" },
    ],
  })),
})

const convertHdRoutesToPcbTraces = (
  srj: SimpleRouteJson,
  hdRoutes: HighDensityRoute[],
): SimplifiedPcbTraces =>
  srj.connections.flatMap((connection) => {
    const netConnectionName =
      connection.netConnectionName ??
      connection.rootConnectionName ??
      connection.name
    return hdRoutes
      .filter((route) => route.connectionName === connection.name)
      .map(
        (route, index): SimplifiedPcbTrace => ({
          type: "pcb_trace",
          pcb_trace_id: `${connection.name}_${index}`,
          connection_name: netConnectionName,
          route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
        }),
      )
  })

const overlapErrors = (srj: SimpleRouteJson, traces: SimplifiedPcbTraces) =>
  getDrcErrors(
    convertToCircuitJson(srj, traces, { minTraceWidth: srj.minTraceWidth }),
  ).locationAwareErrors.filter((e) => e.message.includes("overlaps with trace"))

// The raw merged routes still short (the pipeline models crossings as cost, not a
// hard constraint), but guaranteeNoSameLayerShorts - now wired into
// getOutputSimplifiedPcbTraces - truncates every offender, so the pipeline OUTPUT
// is guaranteed free of different-net same-layer overlaps.
test("dense crossbar: raw routes short, guaranteed output does not", () => {
  // 22 reversed nets in a 2 x ~8.4 mm window saturate the via budget, forcing
  // many same-layer crossings (26 in the raw routes at time of writing).
  const srj = buildCrossbarSrj(22, 0.4, 2)
  const pipeline = new AutoroutingPipelineSolver(structuredClone(srj))
  pipeline.solve()
  expect(pipeline.failed).toBe(false)

  const srjWithPointPairs = pipeline.srjWithPointPairs ?? srj
  const hdRoutes = pipeline.highDensityStitchSolver?.mergedHdRoutes
  if (!hdRoutes)
    throw new Error("pipeline produced no merged high-density routes")

  const rawErrors = overlapErrors(
    srjWithPointPairs,
    convertHdRoutesToPcbTraces(srjWithPointPairs, hdRoutes),
  )
  const outputErrors = overlapErrors(
    srjWithPointPairs,
    pipeline.getOutputSimplifiedPcbTraces(),
  )

  expect(rawErrors.length).toBeGreaterThan(0) // bug: unresolved crossings
  expect(outputErrors.length).toBe(0) // fix: guaranteed short-free output
}, 90_000)
