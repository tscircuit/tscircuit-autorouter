import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createTopologyMergingTestNode, getAvailableZAtPoint } from "../../../fixtures/topology-merging-test-utils"

test("a target pad cannot become a free through-via region", (): void => {
  const bounds = { minX: 0, maxX: 2, minY: 0, maxY: 2 }
  const top = createTopologyMergingTestNode({ id: "top-pad", bounds, availableZ: [0] })
  top._containsObstacle = true
  top._containsTarget = true
  top._targetConnectionName = "signal"
  top._connectedTo = ["signal"]
  const bottom = createTopologyMergingTestNode({ id: "bottom-free", bounds, availableZ: [1] })
  const solver = new TopologyMergingSolver({
    layerCount: 2,
    minViaPadDiameter: 0.3,
    nodeGroups: [{ groupId: "component", isComponent: true, nodes: [top, bottom] }],
  })
  solver.solve()
  expect(getAvailableZAtPoint(solver.getOutput(), { x: 1, y: 1 })).toEqual([[0], [1]])
  expect(solver.getOutput().find((node) => node.availableZ.includes(0))?._targetConnectionName).toBe("signal")
  expect(solver.getOutput().find((node) => node.availableZ.includes(1))?._connectedTo).toBeUndefined()
})
