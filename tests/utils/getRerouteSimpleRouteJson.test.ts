import { expect, test } from "bun:test"
import { getBoundingBox } from "@tscircuit/math-utils"
import {
  getRerouteSimpleRouteJson,
  reconnectReroutedSimpleRouteJsonRegion,
} from "lib/utils/getRerouteSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjTracesToObstacles } from "lib/utils/convertSrjTracesToObstacles"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  obstacles: [],
  connections: [
    {
      name: "source_net_0",
      pointsToConnect: [
        { x: -5, y: 0, layer: "top" },
        { x: 5, y: 0, layer: "top" },
      ],
    },
  ],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "source_net_0_0",
      connection_name: "source_net_0",
      route: [
        { route_type: "wire", x: -5, y: 0, width: 0.15, layer: "top" },
        { route_type: "wire", x: 5, y: 0, width: 0.15, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "source_net_1_0",
      connection_name: "source_net_1",
      route: [
        { route_type: "wire", x: -5, y: 5, width: 0.15, layer: "top" },
        { route_type: "wire", x: 5, y: 5, width: 0.15, layer: "top" },
      ],
    },
  ],
}

test("getRerouteSimpleRouteJson clips traces out of a rectangular region", () => {
  const rerouted = getRerouteSimpleRouteJson(srj, {
    shape: "rect",
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
  })

  expect(rerouted.connections).toHaveLength(1)
  expect(rerouted.bounds).toEqual({
    minX: -1.075,
    maxX: 1.075,
    minY: -1,
    maxY: 1,
  })
  expect(rerouted.connections[0]?.rootConnectionName).toBe("source_net_0")
  expect(rerouted.connections[0]?.pointsToConnect).toEqual([
    { x: -1, y: 0, layer: "top" },
    { x: 1, y: 0, layer: "top" },
  ])
  expect(
    rerouted.obstacles.filter((obstacle) =>
      obstacle.obstacleId?.startsWith(
        "source_net_0_reroute_source_net_0_0_0_route_endpoint_",
      ),
    ),
  ).toEqual([
    {
      obstacleId: "source_net_0_reroute_source_net_0_0_0_route_endpoint_0",
      type: "rect",
      layers: ["top"],
      center: { x: -1, y: 0 },
      width: 0.15,
      height: 0.15,
      connectedTo: ["source_net_0_reroute_source_net_0_0_0", "source_net_0"],
    },
    {
      obstacleId: "source_net_0_reroute_source_net_0_0_0_route_endpoint_1",
      type: "rect",
      layers: ["top"],
      center: { x: 1, y: 0 },
      width: 0.15,
      height: 0.15,
      connectedTo: ["source_net_0_reroute_source_net_0_0_0", "source_net_0"],
    },
  ])

  const affectedTracePieces = rerouted.traces?.filter((trace) =>
    trace.pcb_trace_id.startsWith("source_net_0_0_keep_"),
  )
  expect(affectedTracePieces).toHaveLength(2)
  expect(
    rerouted.traces?.some((trace) => trace.pcb_trace_id === "source_net_1_0"),
  ).toBe(true)
})

test("getRerouteSimpleRouteJson keeps trace endpoints inside the region connectable", () => {
  const rerouted = getRerouteSimpleRouteJson(
    {
      ...srj,
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "source_net_0_inside",
          connection_name: "source_net_0",
          route: [
            { route_type: "wire", x: -0.5, y: 0, width: 0.15, layer: "top" },
            { route_type: "wire", x: 0.5, y: 0, width: 0.15, layer: "top" },
          ],
        },
      ],
    },
    {
      shape: "rect",
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    },
  )

  expect(rerouted.connections).toHaveLength(1)
  expect(rerouted.connections[0]?.pointsToConnect).toEqual([
    { x: -0.5, y: 0, layer: "top" },
    { x: 0.5, y: 0, layer: "top" },
  ])
  expect(
    rerouted.obstacles.map((obstacle) => ({
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      layers: obstacle.layers,
    })),
  ).toEqual([
    {
      center: { x: -0.5, y: 0 },
      width: 0.15,
      height: 0.15,
      layers: ["top"],
    },
    {
      center: { x: 0.5, y: 0 },
      width: 0.15,
      height: 0.15,
      layers: ["top"],
    },
  ])
  expect(rerouted.traces).toHaveLength(0)
})

test("getRerouteSimpleRouteJson does not add endpoint obstacles inside same-net obstacles", () => {
  const rerouted = getRerouteSimpleRouteJson(
    {
      ...srj,
      obstacles: [
        {
          obstacleId: "source_net_0_pad",
          type: "rect",
          layers: ["top"],
          center: { x: -0.5, y: 0 },
          width: 1,
          height: 1,
          connectedTo: ["source_net_0"],
        },
      ],
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "source_net_0_inside_pad",
          connection_name: "source_net_0",
          route: [
            { route_type: "wire", x: -0.5, y: 0, width: 0.15, layer: "top" },
            { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
          ],
        },
      ],
    },
    {
      shape: "rect",
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    },
  )

  expect(rerouted.connections).toHaveLength(1)
  expect(rerouted.connections[0]?.pointsToConnect).toEqual([
    { x: -0.5, y: 0, layer: "top" },
    { x: 1, y: 0, layer: "top" },
  ])
  expect(
    rerouted.obstacles.map((obstacle) => obstacle.obstacleId).sort(),
  ).toEqual([
    "source_net_0_pad",
    "source_net_0_reroute_source_net_0_inside_pad_0_route_endpoint_1",
  ])
})

test("getRerouteSimpleRouteJson expands bounds for clipped trace segment obstacles", () => {
  const rerouted = getRerouteSimpleRouteJson(
    {
      ...srj,
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "source_net_0_tiny_segments",
          connection_name: "source_net_0",
          route: [
            {
              route_type: "wire",
              x: -1.1,
              y: -0.1,
              width: 0.15,
              layer: "top",
            },
            { route_type: "wire", x: -0.2, y: 0.8, width: 0.15, layer: "top" },
          ],
        },
      ],
    },
    {
      shape: "rect",
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    },
  )

  expect(rerouted.bounds.minX).toBeLessThan(-1.075)
  expect(rerouted.bounds.maxX).toBe(1)
  expect(rerouted.bounds.minY).toBe(-1)
  expect(rerouted.bounds.maxY).toBe(1)

  const reroutedWithTraceObstacles = convertSrjTracesToObstacles(rerouted)
  const traceObstacles =
    reroutedWithTraceObstacles?.obstacles.filter((obstacle) =>
      obstacle.obstacleId?.startsWith(
        "trace_obstacle_source_net_0_tiny_segments",
      ),
    ) ?? []

  expect(traceObstacles).toHaveLength(1)
  expect(
    traceObstacles.every((obstacle) => {
      const obstacleBounds = getBoundingBox(obstacle)
      return (
        obstacleBounds.minX >= rerouted.bounds.minX - 1e-9 &&
        obstacleBounds.maxX <= rerouted.bounds.maxX + 1e-9 &&
        obstacleBounds.minY >= rerouted.bounds.minY - 1e-9 &&
        obstacleBounds.maxY <= rerouted.bounds.maxY + 1e-9
      )
    }),
  ).toBe(true)
})

test("reconnectReroutedSimpleRouteJsonRegion restores original connections", () => {
  const rerouted = getRerouteSimpleRouteJson(srj, {
    shape: "rect",
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
  })
  rerouted.traces?.push({
    type: "pcb_trace",
    pcb_trace_id: "rerouted_trace_0",
    connection_name: rerouted.connections[0]!.name,
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
    ],
  })

  const reconnected = reconnectReroutedSimpleRouteJsonRegion(srj, rerouted)

  expect(reconnected.connections).toEqual(srj.connections)
  expect(
    reconnected.traces?.find(
      (trace) => trace.pcb_trace_id === "rerouted_trace_0",
    )?.connection_name,
  ).toBe("source_net_0")
})
