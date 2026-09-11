import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"

test("four-layer output allows partial spans unless blind and buried vias are disabled", () => {
  const highDensityRoute: HighDensityRoute = {
    connectionName: "SIGNAL",
    traceThickness: 0.15,
    viaDiameter: 0.45,
    route: [
      { x: -3, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 2 },
      { x: 3, y: 0, z: 2 },
    ],
    vias: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ],
  }
  const getPipelineOutput = (
    allowBlindAndBuriedVias?: boolean,
  ): {
    traces: SimplifiedPcbTraces
    viaSpans: Array<[string, string]>
  } => {
    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: [
        {
          name: "SIGNAL",
          pointsToConnect: [
            { x: -3, y: 0, layer: "top" },
            { x: 3, y: 0, layer: "inner2" },
          ],
        },
      ],
      originalConnections: [],
      hdRoutes: [highDensityRoute],
      layerCount: 4,
      obstacles: [],
      defaultViaHoleDiameter: 0.3,
      connMap: new ConnectivityMap({}),
      allowBlindAndBuriedVias,
    })
    const viaSpans = traces[0]!.route.flatMap((segment) =>
      segment.route_type === "via"
        ? [[segment.from_layer, segment.to_layer] as [string, string]]
        : [],
    )

    return { traces, viaSpans }
  }

  const legacySpans: Array<[string, string]> = [
    ["top", "inner1"],
    ["inner1", "inner2"],
  ]
  const legacyOutput = getPipelineOutput()
  expect(legacyOutput.viaSpans).toEqual(legacySpans)
  expect(getPipelineOutput(true)).toEqual(legacyOutput)
  const throughViaOutput = getPipelineOutput(false)
  expect(throughViaOutput.viaSpans).toEqual([
    ["top", "bottom"],
    ["top", "bottom"],
  ])
  const viaObstacle = getObstaclesFromSrjTraces({
    layerCount: 4,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [],
    bounds: { minX: -4, maxX: 4, minY: -1, maxY: 1 },
    traces: throughViaOutput.traces,
  }).find((obstacle) => obstacle.obstacleId?.endsWith("_via"))
  expect(viaObstacle?.layers).toEqual(["top", "inner1", "inner2", "bottom"])

  const terminalRoute = convertHdRouteToSimplifiedRoute(
    {
      connectionName: "TERMINAL_SIGNAL",
      traceThickness: 0.15,
      viaDiameter: 0.45,
      route: [
        { x: -3, y: -1, z: 1 },
        { x: 3, y: -1, z: 1 },
      ],
      vias: [],
    },
    4,
    {
      connectionPoints: [
        {
          x: -3,
          y: -1,
          layer: "inner1",
          terminalVia: { toLayer: "top" },
        },
      ],
      allowBlindAndBuriedVias: false,
    },
  )
  expect(
    terminalRoute.find((segment) => segment.route_type === "via"),
  ).toMatchObject({ from_layer: "top", to_layer: "bottom" })
})
