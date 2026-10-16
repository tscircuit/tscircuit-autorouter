import { expect, test } from "bun:test"
import { getSameLayerViaRemovalInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getSameLayerViaRemovalInput"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("local via removal retains crossing fixed copper and rotated pads whose centers lie outside the search", (): void => {
  const target: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ],
  }
  const crossing: HighDensityRoute = {
    connectionName: "fixed",
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: -20, y: 2, z: 0 },
      { x: 20, y: 2, z: 0 },
    ],
    vias: [],
  }
  const distant: HighDensityRoute = {
    ...crossing,
    connectionName: "distant",
    route: [
      { x: -20, y: 20, z: 0 },
      { x: 20, y: 20, z: 0 },
    ],
  }
  const problem = getSameLayerViaRemovalInput({
    srj: {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: -30, maxX: 30, minY: -30, maxY: 30 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          center: { x: 8, y: 0 },
          width: 0.5,
          height: 8,
          ccwRotationDegrees: 45,
          layers: ["top"],
          connectedTo: [],
        },
        {
          type: "rect",
          center: { x: 20, y: 20 },
          width: 1,
          height: 1,
          layers: ["top"],
          connectedTo: [],
        },
      ],
    },
    routes: [target, distant],
    fixedRoutes: [crossing],
    routeIndex: 0,
  })

  expect(problem!.routes).toEqual([target, crossing])
  expect(problem!.routes[problem!.routeIndex]).toBe(target)
  expect(problem!.srj.obstacles).toHaveLength(1)
  expect(problem!.srj.obstacles[0]!.ccwRotationDegrees).toBe(45)
})
