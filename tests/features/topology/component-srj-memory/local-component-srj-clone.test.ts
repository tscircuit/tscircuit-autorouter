import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import type { SerializedTopologyComponentInput } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import { createComponentSrj } from "lib/solvers/TopologyPlanningSolver/topologyPlanningShared"

test("local component topology copies non-obstacle SRJ data without cloning unused global obstacles", () => {
  const input = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.4,
    obstacles: [
      {
        type: "rect",
        componentId: "U1",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["portA"],
      },
      {
        type: "rect",
        componentId: "U2",
        center: { x: 4, y: 4 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["portB"],
      },
    ],
    connections: [
      {
        name: "netA",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "portA" }],
      },
    ],
  } as SimpleRouteJson
  const component = {
    componentId: "U1",
    componentKind: "bga",
    memberObstacleIds: ["pad-a"],
    memberObstacles: [input.obstacles[0]!],
    replacementObstacle: input.obstacles[0]!,
  } as SerializedTopologyComponentInput

  const output = createComponentSrj({ inputSrj: input, component })
  const expected = {
    ...structuredClone(input),
    bounds: output.bounds,
    obstacles: output.obstacles,
  }
  expect(output).toEqual(expected)
  expect(Object.keys(output)).toEqual(Object.keys(input))
  expect(output.obstacles).toHaveLength(1)
  expect(output.obstacles[0]).not.toBe(input.obstacles[0])
  expect(output.obstacles[0]!.connectedTo).toBe(input.obstacles[0]!.connectedTo)
  expect(output.connections).not.toBe(input.connections)
  output.connections[0]!.pointsToConnect[0]!.x = 9
  expect(input.connections[0]!.pointsToConnect[0]!.x).toBe(0)
  expect(input.obstacles).toHaveLength(2)
})
