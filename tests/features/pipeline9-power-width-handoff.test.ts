import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline 9 preserves width targets for route pieces with shared endpoints", () => {
  const connections: SimpleRouteConnection[] = [
    "unrouted",
    "sense",
    "supply",
    "ordinary",
  ].map((name) => ({
    name,
    __rootConnectionNames: ["shared_net"],
    pointsToConnect: [
      { x: 0, y: 0, layer: "top", pointId: "start" },
      { x: 2, y: 0, layer: "top", pointId: "end" },
    ],
  }))
  const hdRoutes: HighDensityRoute[] = [
    "supply",
    "ordinary",
    "sense",
    "supply",
  ].map((connectionName) => ({
    connectionName,
    traceThickness: 0.15,
    viaDiameter: 0.4,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }))
  const conversionInput = {
    connections,
    originalConnections: [],
    hdRoutes,
    layerCount: 2,
    obstacles: [],
    defaultViaHoleDiameter: 0.2,
    connMap: new ConnectivityMap({}),
  }

  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    ...conversionInput,
    nominalTraceWidthByConnectionName: new Map([
      ["sense", 0.15],
      ["supply", 0.8],
    ]),
  })
  expect(
    routedTraces.map(({ pcb_trace_id, nominalTraceWidth }) => [
      pcb_trace_id,
      nominalTraceWidth,
    ]),
  ).toEqual([
    ["sense_0", 0.15],
    ["supply_0", 0.8],
    ["supply_1", 0.8],
    ["ordinary_0", undefined],
  ])
  expect(
    convertPipeline7HdRoutesToSimplifiedPcbTraces(conversionInput).every(
      (trace) => !("nominalTraceWidth" in trace),
    ),
  ).toBe(true)
})
