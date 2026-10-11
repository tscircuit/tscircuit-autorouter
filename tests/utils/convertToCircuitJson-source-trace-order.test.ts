import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("source trace lookup preserves first routes, merged ID order and fresh conversion inputs", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 12, minY: -1, maxY: 1 },
    obstacles: [0, 1, 2, 4].map((x) => ({
      type: "rect",
      layers: ["top"],
      center: { x, y: 0 },
      width: 0.4,
      height: 0.4,
      connectedTo: [`obstacle_net_${x}`],
    })),
    connections: [1, 2].map((x) => ({
      name: `branch_${x}`,
      __netConnectionName: "root",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "p0", pointId: "q0" },
        { x, y: 0, layer: "top", pcb_port_id: `p${x}`, pointId: `q${x}` },
      ],
    })),
  }
  const traces: SimplifiedPcbTrace[] = [
    ["first", "branch_1", 0, 1],
    ["duplicate", "branch_1", 4, 5],
    ["shared_endpoint", "branch_2", 0, 2],
  ].map(([id, name, startX, endX]) => ({
    type: "pcb_trace",
    pcb_trace_id: String(id),
    connection_name: String(name),
    route: [Number(startX), Number(endX)].map((x) => ({
      route_type: "wire",
      x,
      y: 0,
      width: 0.1,
      layer: "top",
    })),
  }))
  traces.push({
    type: "pcb_trace",
    pcb_trace_id: "extra_connection",
    connection_name: "undeclared_branch",
    connectsTo: ["p0", "extra_net"],
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "top" },
    ],
  })
  const first = convertToCircuitJson(srj, traces)
  const source = first.find((element) => element.type === "source_trace")
  expect(source).toEqual({
    type: "source_trace",
    source_trace_id: "root",
    connected_source_port_ids: ["p0", "p1", "p2"],
    connected_source_net_ids: [
      "obstacle_net_0", "obstacle_net_1", "q0", "q1", "q2",
      "obstacle_net_2", "extra_net",
    ],
  })
  srj.obstacles[0]!.connectedTo = ["changed_obstacle_net"]
  const second = convertToCircuitJson(srj, traces)
  const updatedSource = second.find((element) => element.type === "source_trace")
  expect(updatedSource?.type).toBe("source_trace")
  if (updatedSource?.type !== "source_trace") throw new Error("Missing source trace")
  expect(updatedSource.connected_source_net_ids[0]).toBe("changed_obstacle_net")
  expect(updatedSource.connected_source_net_ids).not.toContain("obstacle_net_0")
  expect(updatedSource.connected_source_net_ids).not.toContain("obstacle_net_4")
  expect(first.find((element) => element.type === "source_trace")).toEqual(source)
})
