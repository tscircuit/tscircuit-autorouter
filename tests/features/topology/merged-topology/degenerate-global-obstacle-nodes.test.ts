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

type ObstacleSpec = {
  id: string
  x: number
  y: number
  width: number
  height: number
  connectedTo?: string[]
}

function createObstacle({
  id,
  x,
  y,
  width,
  height,
  connectedTo = [],
}: ObstacleSpec): Obstacle {
  return {
    obstacleId: id,
    type: "rect",
    layers: ["top"],
    __zLayers: [0],
    center: { x, y },
    width,
    height,
    connectedTo,
  }
}

/**
 * Two obstacles whose dimensions sit between 0 and GEOMETRY_EPSILON. RectDiff
 * only drops rects with a non-positive dimension, so these reach topology
 * planning and become zero-area capacity nodes.
 */
function createDegenerateObstacleSrj(): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.35,
    defaultObstacleMargin: 0.12,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      createObstacle({ id: "dust_width", x: 0, y: 0, width: 5e-10, height: 1 }),
      createObstacle({
        id: "dust_height",
        x: 2,
        y: 2,
        width: 1,
        height: 1e-10,
      }),
      createObstacle({
        id: "start_pad",
        x: -4,
        y: -4,
        width: 0.3,
        height: 0.3,
        connectedTo: ["start_port"],
      }),
      createObstacle({
        id: "end_pad",
        x: 4,
        y: 4,
        width: 0.3,
        height: 0.3,
        connectedTo: ["end_port"],
      }),
    ],
    connections: [
      {
        name: "dust_net",
        pointsToConnect: [
          { pointId: "start_port", x: -4, y: -4, layer: "top" },
          { pointId: "end_port", x: 4, y: 4, layer: "top" },
        ],
      },
    ],
  }
}

test("degenerate obstacles do not reach topology merging as global nodes", (): void => {
  const inputSrj = createDegenerateObstacleSrj()
  const topologyPlanningSolver =
    createTopologyPlanningSolverForMerging(inputSrj)
  topologyPlanningSolver.solve()

  const globalMeshNodes = topologyPlanningSolver.getOutput().globalMeshNodes
  const degenerateNodeIds = globalMeshNodes
    .filter((node) => !isValidCapacityBounds(getCapacityMeshNodeBounds(node)))
    .map((node) => node.capacityMeshNodeId)

  expect(topologyPlanningSolver.failed).toBe(false)
  expect(globalMeshNodes.length).toBeGreaterThan(0)
  expect(degenerateNodeIds).toEqual([])

  const topologyMergingSolver = createTopologyMergingSolverFromPlanning({
    inputSrj,
    topologyPlanningSolver,
  })
  topologyMergingSolver.solve()

  expect(topologyMergingSolver.solved).toBe(true)
  expect(topologyMergingSolver.failed).toBe(false)
  expect(topologyMergingSolver.getOutput().length).toBeGreaterThan(0)
})
