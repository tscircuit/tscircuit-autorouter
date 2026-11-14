import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { createComponentObstacleSrj } from "lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver"

test("global component replacement preserves deep-cloned non-obstacle fields", () => {
  const input = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 4,
    minTraceWidth: 0.1,
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
    bounds: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 },
  } as DetectedComponent
  const output = createComponentObstacleSrj({
    inputSrj: input,
    detectedComponents: [component],
  })
  const expected = { ...structuredClone(input), obstacles: output.obstacles }
  expect(output).toEqual(expected)
  expect(Object.keys(output)).toEqual(Object.keys(input))
  expect(output.obstacles).toHaveLength(2)
  expect(output.obstacles[0]).toBe(input.obstacles[1])
  expect(output.obstacles[1]!.connectedTo).toEqual(["portA"])
  expect(output.connections).not.toBe(input.connections)
  output.connections[0]!.pointsToConnect[0]!.x = 9
  expect(input.connections[0]!.pointsToConnect[0]!.x).toBe(0)
  expect(input.obstacles).toHaveLength(2)
})
