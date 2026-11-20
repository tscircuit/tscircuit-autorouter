import { expect, test } from "bun:test"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("fixed copper accepts exact clearance despite floating-point roundoff", (): void => {
  const nativeRoute: HighDensityRoute = {
    connectionName: "source_trace_0",
    traceThickness: 0.1,
    viaDiameter: 0.5,
    route: [
      { x: -2, y: -1.8, z: 1 },
      { x: -1.72, y: -1.905, z: 1 },
    ],
    vias: [],
  }
  const nativeFixedRoute: HighDensityRoute = {
    connectionName: "breakout:pcb_breakout_point_0_fixed_1_6",
    traceThickness: 0.1,
    viaDiameter: 0.5,
    route: [
      { x: -3.898999999999999, y: -1.6, z: 1 },
      { x: -2, y: -1.6, z: 1 },
    ],
    vias: [],
  }
  const wireRoute: HighDensityRoute = {
    connectionName: "wire",
    traceThickness: 0.1,
    viaDiameter: 0.5,
    route: [
      { x: -3, y: -0.8, z: 1 },
      { x: -1, y: -0.8, z: 1 },
    ],
    vias: [],
  }
  const viaRoute: HighDensityRoute = {
    connectionName: "via",
    traceThickness: 0.1,
    viaDiameter: 0.5,
    route: [
      { x: -2, y: -1.2, z: 0 },
      { x: -2, y: -1.2, z: 1 },
    ],
    vias: [{ x: -2, y: -1.2 }],
  }
  const boundaryPairs = [
    {
      left: nativeRoute,
      right: nativeFixedRoute,
      closerRightOffsetY: -0.0001,
    },
    { left: wireRoute, right: viaRoute, closerRightOffsetY: 0.0001 },
    { left: viaRoute, right: wireRoute, closerRightOffsetY: -0.0001 },
    {
      left: { ...viaRoute, viaDiameter: 0.3 },
      right: {
        ...viaRoute,
        connectionName: "neighbor-via",
        viaDiameter: 0.3,
        route: viaRoute.route.map((point) => ({ ...point, y: -0.8 })),
        vias: [{ x: -2, y: -0.8 }],
      },
      closerRightOffsetY: -0.0001,
    },
  ]

  for (const { left, right, closerRightOffsetY } of boundaryPairs) {
    expect(
      doPipeline9RoutesHaveCopperConflict({
        left,
        right,
        clearance: 0.1,
        layerCount: 2,
      }),
    ).toBe(false)
    const closerRight = {
      ...right,
      route: right.route.map((point) => ({
        ...point,
        y: point.y + closerRightOffsetY,
      })),
      vias: right.vias.map((via) => ({
        ...via,
        y: via.y + closerRightOffsetY,
      })),
    }
    expect(
      doPipeline9RoutesHaveCopperConflict({
        left,
        right: closerRight,
        clearance: 0.1,
        layerCount: 2,
      }),
    ).toBe(true)
  }
})
