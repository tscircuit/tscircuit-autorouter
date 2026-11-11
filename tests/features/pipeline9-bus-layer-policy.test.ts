import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { getConnectionAllowedZ } from "lib/utils/getConnectionAllowedZ"
import { selectConnectionPointRegion } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/select-connection-point-region"
import type {
  HyperGraphHg,
  RegionHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

test("ButterStick bus layers survive MST names and intersect merged nets", () => {
  // Native board-world terminal coordinates in mm; physical layer count stays 8.
  const busConnection: SimpleRouteConnection = {
    name: "source_trace_43",
    source_trace_id: "",
    pointsToConnect: [
      { x: -0.09999999999998899, y: 3.9999999999999947, layer: "top" },
      { x: -0.09999999999998899, y: -7.400000000000011, layer: "top" },
      { x: -7.2000000000000055, y: 1.1999999999999944, layer: "top" },
    ],
  }
  const freeConnection: SimpleRouteConnection = {
    name: "source_trace_14",
    source_trace_id: "",
    pointsToConnect: [
      { x: 10.300000000000011, y: 7.999999999999994, layer: "top" },
      { x: -4.800000000000006, y: 0.39999999999999436, layer: "top" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 8,
    minTraceWidth: 0.089,
    bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
    obstacles: [],
    connections: [busConnection, freeConnection],
    buses: [
      {
        busId: "DDR_BUS_byte1",
        connectionNames: [busConnection.name],
        allowedLayers: ["top", "inner2", "inner5", "inner6", "bottom"],
      },
    ],
  }
  const original = JSON.stringify(srj)
  const solver = new NetToPointPairsSolver(srj, {}, new ConnectivityMap({}))
  solver.solve()
  const output = solver.getNewSimpleRouteJson()
  const busPairs = output.connections.filter((connection) =>
    connection.__rootConnectionNames?.includes(busConnection.name),
  )
  expect(busPairs).toHaveLength(2)
  for (const pair of busPairs) {
    expect(pair.allowedLayers).toEqual(srj.buses![0]!.allowedLayers)
    expect(getConnectionAllowedZ(output).get(pair.name)).toEqual([
      0, 2, 5, 6, 7,
    ])
  }
  expect(getConnectionAllowedZ(output).has(freeConnection.name)).toBe(false)
  expect(JSON.stringify(srj)).toBe(original)

  const continuation: SimpleRouteConnection = {
    name: "continuation",
    allowedLayers: ["top", "bottom"],
    pointsToConnect: [
      busConnection.pointsToConnect[0]!,
      { x: 2, y: 8, layer: "top" },
    ],
  }
  const merged = new NetToPointPairsSolver(
    {
      ...srj,
      connections: [
        { ...busConnection, allowedLayers: ["top", "inner2"] },
        continuation,
      ],
    },
    {},
    new ConnectivityMap({}),
  )
  merged.solve()
  expect(
    merged.newConnections.every(
      (connection) => connection.allowedLayers?.join(",") === "top",
    ),
  ).toBe(true)
  expect(() =>
    getConnectionAllowedZ({
      ...srj,
      buses: [{ ...srj.buses![0]!, allowedLayers: ["inner2"] }],
    }),
  ).toThrow("source_trace_43")
  expect(() =>
    getConnectionAllowedZ({
      ...srj,
      buses: [{ ...srj.buses![0]!, allowedLayers: ["inner99"] }],
    }),
  ).toThrow("invalid allowed layer")

  const preloaded: SimpleRouteJson = {
    ...srj,
    connections: [
      {
        ...busConnection,
        netConnectionName: "bus-net",
        pointsToConnect: busConnection.pointsToConnect.map((point, index) =>
          index === 0 ? { ...point, pointId: "bus-terminal" } : point,
        ),
      },
      freeConnection,
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "escape",
        connection_name: "fanout",
        connectsTo: ["bus-terminal"],
        route: [],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "continuation",
        connection_name: "continued-fanout",
        connectsTo: ["escape"],
        route: [],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "net-preload",
        connection_name: "net-fanout",
        connectsTo: ["bus-net"],
        route: [],
      },
    ],
  }
  const preloadedPolicies = getConnectionAllowedZ(preloaded)
  for (const alias of ["fanout", "escape", "continued-fanout", "net-fanout"]) {
    expect(preloadedPolicies.get(alias)).toEqual([0, 2, 5, 6, 7])
  }
  expect(preloadedPolicies.has(freeConnection.name)).toBe(false)
  expect(getConnectionAllowedZ({ ...preloaded, buses: undefined }).size).toBe(0)

  const regions: RegionHg[] = [0, 7].map((z) => ({
    regionId: `terminal-region-${z}`,
    ports: [],
    d: {
      capacityMeshNodeId: `terminal-region-${z}`,
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layer: z === 0 ? "top" : "bottom",
      availableZ: [z],
    },
  }))
  const graph: HyperGraphHg = { regions, ports: [] }
  const point = { x: 0, y: 0, layers: ["top", "bottom"] }
  expect(selectConnectionPointRegion({ graph, point, layerCount: 8 })).toBe(
    regions[0],
  )
  expect(
    selectConnectionPointRegion({
      graph,
      point,
      layerCount: 8,
      allowedLayers: ["bottom"],
    }),
  ).toBe(regions[1])
  expect(point.layers).toEqual(["top", "bottom"])
})
