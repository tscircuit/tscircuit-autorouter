import { expect, test } from "bun:test"
import {
  getCapacityMeshNodeBounds,
  isValidCapacityBounds,
} from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import {
  createTopologyMergingSolverFromPlanning,
  createTopologyPlanningSolverForMerging,
} from "../../../fixtures/topology-merging-test-utils"

function createObstacle({
  id,
  x,
  y,
  width,
  height,
  connectedTo = [],
}: {
  id: string
  x: number
  y: number
  width: number
  height: number
  connectedTo?: string[]
}): Obstacle {
  return {
    obstacleId: id,
    type: "rect",
    layers: ["top"],
    zLayers: [0],
    center: { x, y },
    width,
    height,
    connectedTo,
  }
}

/**
 * Reproduces https://github.com/tscircuit/tscircuit-autorouter/issues/1614:
 * a near-zero-width obstacle makes the RectDiff global solve emit a degenerate
 * (zero-area) mesh node, which used to crash TopologyMergingSolver input
 * validation with 'node "cmn_N" in group "global" has invalid bounds'.
 */
test("topology planning drops degenerate global mesh nodes before merging", (): void => {
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.35,
    defaultObstacleMargin: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      createObstacle({
        id: "pad_a",
        x: -3,
        y: 0,
        width: 0.6,
        height: 0.6,
        connectedTo: ["pad_a_port"],
      }),
      createObstacle({
        id: "pad_b",
        x: 3,
        y: 0,
        width: 0.6,
        height: 0.6,
        connectedTo: ["pad_b_port"],
      }),
      // Near-zero-width sliver as it can arrive from upstream circuit-json
      // float dust. RectDiff only filters exactly-zero rect sizes, so this
      // becomes a zero-area "cmn_*" node in the global mesh.
      createObstacle({
        id: "degenerate_keepout",
        x: 0,
        y: 4,
        width: 5e-10,
        height: 1,
      }),
    ],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { pointId: "pad_a_port", x: -3, y: 0, layer: "top" },
          { pointId: "pad_b_port", x: 3, y: 0, layer: "top" },
        ],
      },
    ],
  }

  const topologyPlanningSolver =
    createTopologyPlanningSolverForMerging(inputSrj)
  topologyPlanningSolver.solve()
  const topologyOutput = topologyPlanningSolver.getOutput()

  expect(
    topologyOutput.globalMeshNodes.every((node) =>
      isValidCapacityBounds(getCapacityMeshNodeBounds(node)),
    ),
  ).toBe(true)

  const topologyMergingSolver = createTopologyMergingSolverFromPlanning({
    inputSrj,
    topologyPlanningSolver,
  })
  topologyMergingSolver.solve()

  expect(topologyMergingSolver.solved).toBe(true)
  expect(topologyMergingSolver.failed).toBe(false)
  expect(topologyMergingSolver.getOutput().length).toBeGreaterThan(0)
})
