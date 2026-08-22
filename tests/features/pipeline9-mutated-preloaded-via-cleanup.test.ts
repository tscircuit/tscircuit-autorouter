import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { removeUselessViasFromMutatedPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/remove-useless-vias-from-mutated-preloaded-traces"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const firstVia = { x: 8.443, y: -4.145 }
const secondVia = { x: 8.847, y: -4.447 }

const createMutatedTrace = (): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: "source_trace_10_0",
  connection_name: "source_trace_10",
  __replaces_pcb_trace_id: "source_trace_10_0",
  route: [
    {
      route_type: "wire",
      x: 8.379,
      y: -4.038,
      width: 0.15,
      layer: "top",
    },
    {
      route_type: "wire",
      ...firstVia,
      width: 0.15,
      layer: "top",
    },
    {
      route_type: "via",
      ...firstVia,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.5,
      via_hole_diameter: 0.2,
    },
    {
      route_type: "wire",
      ...firstVia,
      width: 0.15,
      layer: "bottom",
    },
    {
      route_type: "wire",
      x: 8.716,
      y: -3.798,
      width: 0.15,
      layer: "bottom",
    },
    {
      route_type: "wire",
      x: 8.731,
      y: -3.994,
      width: 0.15,
      layer: "bottom",
    },
    {
      route_type: "wire",
      x: 8.76,
      y: -4.186,
      width: 0.15,
      layer: "bottom",
    },
    {
      route_type: "wire",
      x: 8.816,
      y: -4.376,
      width: 0.15,
      layer: "bottom",
    },
    {
      route_type: "wire",
      ...secondVia,
      width: 0.15,
      layer: "bottom",
    },
    {
      route_type: "via",
      ...secondVia,
      from_layer: "bottom",
      to_layer: "top",
      via_diameter: 0.5,
      via_hole_diameter: 0.2,
    },
    {
      route_type: "wire",
      ...secondVia,
      width: 0.15,
      layer: "top",
    },
    {
      route_type: "wire",
      x: 8.92,
      y: -4.572,
      width: 0.15,
      layer: "top",
    },
  ],
})

const runCleanup = (
  trace: SimplifiedPcbTrace,
  otherHdRoutes = [] as HighDensityRoute[],
  originalTrace: SimplifiedPcbTrace = {
    ...trace,
    __replaces_pcb_trace_id: undefined,
    route: [trace.route[0]!, trace.route.at(-1)!],
  },
) =>
  removeUselessViasFromMutatedPreloadedTraces({
    updates: {
      updatedPreloadedTraces: [trace],
      mutatedPreloadedTraces: [trace],
    },
    originalTraces: [originalTrace],
    otherHdRoutes,
    collisionObstacles: [],
    routeConversionObstacles: [],
    colorMap: {},
    connMap: new ConnectivityMap({}),
    layerCount: 2,
    defaultViaDiameter: 0.5,
    defaultViaHoleDiameter: 0.2,
    traceClearance: 0.1,
    obstacleClearance: 0.15,
  }).updatedPreloadedTraces[0]!

test("Pipeline9 removes only collision-free via pairs from mutated preloaded traces", () => {
  const cleanedTrace = runCleanup(createMutatedTrace())

  expect(
    cleanedTrace.route.filter((point) => point.route_type === "via"),
  ).toEqual([])
  expect(
    cleanedTrace.route.every(
      (point) => point.route_type !== "wire" || point.layer === "top",
    ),
  ).toBeTrue()

  const blockingTopRoute: HighDensityRoute = {
    connectionName: "blocking_trace",
    rootConnectionName: "blocking_net",
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 8.706, y: -3.798, z: 0 },
      { x: 8.726, y: -3.798, z: 0 },
    ],
    vias: [],
  }
  const blockedTrace = runCleanup(createMutatedTrace(), [blockingTopRoute])

  expect(
    blockedTrace.route
      .filter((point) => point.route_type === "via")
      .map((point) => ({ x: point.x, y: point.y })),
  ).toEqual([firstVia, secondVia])

  const protectedOriginalVias = runCleanup(
    createMutatedTrace(),
    [],
    createMutatedTrace(),
  )
  expect(
    protectedOriginalVias.route
      .filter((point) => point.route_type === "via")
      .map((point) => ({ x: point.x, y: point.y })),
  ).toEqual([firstVia, secondVia])
})
