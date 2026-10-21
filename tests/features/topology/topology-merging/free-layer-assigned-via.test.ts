import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { Obstacle } from "lib/types"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
} from "../../../fixtures/topology-merging-test-utils"

test("assigned via ownership prevents a free-layer union", (): void => {
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: 1, y: 1 },
    width: 0.3,
    height: 0.3,
    layers: ["top", "bottom"],
    connectedTo: ["assigned-net"],
    netIsAssignable: true,
  }
  for (const assigned of [false, true]) {
    const solver = new TopologyMergingSolver({
      layerCount: 2,
      minViaPadDiameter: 0.3,
      nodeGroups: [
        {
          groupId: "global",
          isComponent: false,
          nodes: [0, 1].map((z) => ({
            ...createTopologyMergingTestNode({
              id: `layer-${z}`,
              bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
              availableZ: [z],
            }),
            _assignedViaObstacle: assigned ? obstacle : undefined,
          })),
        },
      ],
    })
    solver.solve()
    expect(solver.reconstructedViaDomainCount).toBe(assigned ? 0 : 1)
    expect(getAvailableZAtPoint(solver.getOutput(), { x: 1, y: 1 })).toEqual(
      assigned ? [[0], [1]] : [[0, 1]],
    )
    if (assigned) {
      for (const node of solver.getOutput()) {
        expect(node._assignedViaObstacle).toBe(obstacle)
      }
    }
  }
})
