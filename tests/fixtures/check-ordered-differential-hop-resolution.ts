import { expect } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { getDifferentialPairsForPostProcessing as resolve } from "lib/utils/getDifferentialPairsForPostProcessing"
import { orderedUsbPair } from "./ordered-usb-pair"

function getRoutes(connections: SimpleRouteConnection[]): HighDensityRoute[] {
  return connections.map((connection) => ({
    connectionName: connection.name,
    traceThickness: 0.2,
    viaDiameter: 0.6,
    route: connection.pointsToConnect.map(({ x, y }) => ({ x, y, z: 0 })),
    vias: [],
  }))
}

export function checkOrderedDifferentialHopResolution(): void {
  const srj = structuredClone(orderedUsbPair)
  const solver = new NetToPointPairsSolver(
    srj,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(srj),
  )
  solver.solve()
  // Provenance survives reordered outputs even without endpoint IDs.
  const pointPairConnections = solver.newConnections
    .map((connection) => ({
      ...connection,
      pointsToConnect: [...connection.pointsToConnect]
        .reverse()
        .map(({ pointId, ...point }) => point),
    }))
    .reverse()
  const hdRoutes = getRoutes(pointPairConnections)
  const params = {
    srj,
    pointPairConnections,
    pathHopConnectionNames: solver.pathHopConnectionNames,
    hdRoutes,
    pipelineName: "Pipeline7",
  }
  expect(resolve(params)).toEqual({
    differentialPairs: [],
    differentialPairLanes: [
      {
        connectionNames: [
          [
            "source_trace_0__source_trace_2_mst0",
            "source_trace_0__source_trace_2_mst1",
          ],
          ["source_trace_1_mst0", "source_trace_1_mst1"],
        ],
        lengthTolerance: 0.1,
      },
    ],
  })
  const hopName = "source_trace_0__source_trace_2_mst0"
  const route = hdRoutes.find((route) => route.connectionName === hopName)!
  for (const pipelineName of ["Pipeline7", "Pipeline9"]) {
    expect(() =>
      resolve({ ...params, pipelineName, pathHopConnectionNames: new Map() }),
    ).toThrow(
      `${pipelineName}: differential pair connection "source_trace_0" hop pcb_port_1 -> pcb_port_11 is missing`,
    )
    expect(() =>
      resolve({
        ...params,
        pipelineName,
        pathHopConnectionNames: new Map([["source_trace_0", [hopName]]]),
      }),
    ).toThrow(
      `${pipelineName}: differential pair connection "source_trace_0" hop pcb_port_11 -> pcb_port_17 is missing`,
    )
    const path = srj.connections[0]!.path!
    srj.connections[0]!.path = path.slice(0, 1)
    expect(() => resolve({ ...params, pipelineName })).toThrow(
      `${pipelineName}: differential pair connection "source_trace_0" needs at least two path points`,
    )
    srj.connections[0]!.path = path
  }
  expect(() => resolve({ ...params, hdRoutes: [...hdRoutes, route] })).toThrow(
    "must resolve to exactly one final HD route, got 2",
  )
  expect(() =>
    resolve({
      ...params,
      hdRoutes: hdRoutes.filter((output) => output !== route),
    }),
  ).toThrow("must resolve to exactly one final HD route, got 0")

  // Legacy two-terminal SRJs can omit point IDs and paths. Keep their coupled
  // postprocessor, trace gap and uncoupled-length limit unchanged.
  srj.connections = srj.connections
    .filter((connection) => connection.path)
    .map((connection) => ({
      name: connection.name,
      pointsToConnect: connection.pointsToConnect
        .slice(0, 2)
        .map(({ pointId, pcb_port_id, ...point }) => point),
    }))
  srj.differentialPairs![0]!.traceGap = 0.2
  srj.differentialPairs![0]!.maxUncoupledLength = 3
  const singles = srj.connections.map((connection) => ({
    ...connection,
    name: connection.name + "_mst0",
    __rootConnectionNames: [connection.name],
  }))
  const singleParams = {
    srj,
    pointPairConnections: singles,
    hdRoutes: getRoutes(singles),
    pathHopConnectionNames: new Map(),
  }
  expect(resolve(singleParams)).toEqual({
    differentialPairLanes: [],
    differentialPairs: [
      {
        connectionNames: ["source_trace_0_mst0", "source_trace_1_mst0"],
        lengthTolerance: 0.1,
        maxUncoupledLength: 3,
        minimumCenterlineDistance: 0.4,
        maximumCenterlineDistance: 0.4,
      },
    ],
  })
  for (const pipelineName of ["Pipeline7", "Pipeline9"]) {
    expect(() =>
      resolve({
        ...singleParams,
        pipelineName,
        pointPairConnections: [...singles, { ...singles[0]!, name: "split" }],
      }),
    ).toThrow(
      `${pipelineName}: differential pair connection "source_trace_0" must resolve to exactly one final point-pair connection, got 2`,
    )
  }
}
