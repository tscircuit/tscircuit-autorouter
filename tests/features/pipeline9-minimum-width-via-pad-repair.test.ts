import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyPipeline9MinimumWidthViaRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9MinimumWidthViaRepairs"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("a local via-pad repair preserves hard widths and leaves shared junctions fixed", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.15,
    minViaEdgeToPadEdgeClearance: 0.15,
    allowViaInPad: false,
    connections: [
      {
        name: "POWER",
        minTraceWidth: 0.15,
        pointsToConnect: [
          { x: -0.675, y: 0, layer: "top", pcb_port_id: "pcb_port_power" },
          { x: 1.5, y: 1.5, layer: "bottom" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -0.675, y: 0 },
        width: 0.8,
        height: 0.95,
        connectedTo: ["pcb_smtpad_0", "POWER"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_0",
          pcb_port_id: "pcb_port_power",
        },
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.675, y: 0 },
        width: 0.8,
        height: 0.95,
        connectedTo: ["pcb_smtpad_1", "OTHER"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_1" },
      },
    ],
  }
  const via = { x: -0.093743907976464, y: 0.643158573310306 }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "POWER",
      traceThickness: 0.15,
      viaDiameter: 0.6,
      route: [
        { x: -0.675, y: 0, z: 0 },
        { ...via, z: 0 },
        { ...via, z: 1 },
        { x: 1.5, y: 1.5, z: 1 },
      ],
      vias: [via],
    },
  ]
  const original = structuredClone(routes)
  const connMap = new ConnectivityMap({
    supply: ["POWER", "BRANCH", "pcb_smtpad_0"],
    other: ["OTHER", "pcb_smtpad_1"],
  })
  const params = {
    inputSrj: input,
    srjWithPointPairs: input,
    connections: input.connections,
    routes,
    otherHdRoutes: [],
    connMap,
    viaHoleDiameter: 0.3,
  }
  const output = applyPipeline9MinimumWidthViaRepairs(params)
  expect(output[0].vias).not.toEqual(original[0].vias)
  expect(output[0].traceThickness).toBe(0.15)
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: input.connections,
    originalConnections: input.connections,
    hdRoutes: output,
    layerCount: 2,
    obstacles: input.obstacles,
    defaultViaHoleDiameter: 0.3,
    connMap,
  })
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: input,
      routedTraces: traces,
    }).errors,
  ).toEqual([])
  expect(routes).toEqual(original)
  const branch: HighDensityRoute = {
    connectionName: "BRANCH",
    traceThickness: 0.1,
    viaDiameter: 0.6,
    route: [
      { x: via.x + 0.35, y: via.y, z: 1 },
      { x: 1.6, y: via.y, z: 1 },
    ],
    vias: [],
  }
  const junctionOutput = applyPipeline9MinimumWidthViaRepairs({
    ...params,
    otherHdRoutes: [branch],
  })
  expect(junctionOutput).toEqual(original)
})
