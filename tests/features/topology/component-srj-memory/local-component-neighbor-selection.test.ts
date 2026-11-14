import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import type { SerializedTopologyComponentInput } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import { createComponentSrj } from "lib/solvers/TopologyPlanningSolver/topologyPlanningShared"

test("local topology retains nearby foreign pads but excludes remote same-net geometry", () => {
  const input = {
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.5,
    obstacles: [
      {
        obstacleId: "U1-pad",
        type: "rect",
        componentId: "U1",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        layers: ["top"],
        connectedTo: ["net-a", "net-a"],
      },
      {
        obstacleId: "U2-nearby",
        type: "rect",
        componentId: "U2",
        center: { x: 1.3, y: 0 },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["net-b"],
      },
      {
        obstacleId: "U3-remote",
        type: "rect",
        componentId: "U3",
        center: { x: 6, y: 6 },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["net-a"],
      },
    ],
    connections: [
      {
        name: "net-a",
        pointsToConnect: [
          { x: 1.4, y: 0, layer: "top", pcb_port_id: "net-a" },
          { x: 6, y: 6, layer: "top", pcb_port_id: "net-a" },
        ],
      },
    ],
  } as SimpleRouteJson
  const component = {
    componentId: "U1",
    componentKind: "bga",
    memberObstacleIds: ["U1-pad"],
    memberObstacles: [input.obstacles[0]!],
    replacementObstacle: input.obstacles[0]!,
  } as SerializedTopologyComponentInput

  const output = createComponentSrj({ inputSrj: input, component })
  expect(output.bounds).toEqual({ minX: -1, maxX: 1.4, minY: -1, maxY: 1 })
  expect(output.obstacles.map((obstacle) => obstacle.obstacleId)).toEqual([
    "U1-pad",
    "U2-nearby",
  ])
  expect(output.connections).toEqual(input.connections)
  expect(output.connections).not.toBe(input.connections)
  expect(input.obstacles).toHaveLength(3)
})
