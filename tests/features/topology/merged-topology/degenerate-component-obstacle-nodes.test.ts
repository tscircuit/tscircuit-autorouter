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
  componentId?: string
  connectedTo?: string[]
}

function createObstacle({
  id,
  x,
  y,
  width,
  height,
  componentId,
  connectedTo = [],
}: ObstacleSpec): Obstacle {
  return {
    obstacleId: id,
    componentId,
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
 * A BGA grid with one sub-GEOMETRY_EPSILON member pad. The component-local
 * topology solve turns every member pad into capacity nodes, so the degenerate
 * pad produces zero-area nodes in the "component-0" group.
 */
function createBgaWithDegenerateMemberSrj(): SimpleRouteJson {
  const obstacles: Obstacle[] = []
  const positions = [-1.5, -0.5, 0.5, 1.5]

  for (const x of positions) {
    for (const y of positions) {
      obstacles.push(
        createObstacle({
          id: `u_bga_${obstacles.length}`,
          componentId: "u_bga",
          x,
          y,
          width: 0.25,
          height: 0.25,
        }),
      )
    }
  }

  obstacles.push(
    createObstacle({
      id: "u_bga_dust",
      componentId: "u_bga",
      x: 0,
      y: 1,
      width: 5e-10,
      height: 0.25,
    }),
  )

  return {
    layerCount: 2,
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.35,
    defaultObstacleMargin: 0.12,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [
      ...obstacles,
      createObstacle({
        id: "outside_pad",
        x: 3.2,
        y: 3.2,
        width: 0.3,
        height: 0.3,
        connectedTo: ["outside_port"],
      }),
    ],
    connections: [
      {
        name: "bga_net",
        pointsToConnect: [
          { pointId: "bga_inner_port", x: -0.5, y: -0.5, layer: "top" },
          { pointId: "outside_port", x: 3.2, y: 3.2, layer: "top" },
        ],
      },
    ],
  }
}

test("degenerate component pads do not reach topology merging as nodes", (): void => {
  const inputSrj = createBgaWithDegenerateMemberSrj()
  const topologyPlanningSolver =
    createTopologyPlanningSolverForMerging(inputSrj)
  topologyPlanningSolver.solve()

  const componentMeshNodes = topologyPlanningSolver
    .getOutput()
    .componentMeshNodes.flat()
  const degenerateNodeIds = componentMeshNodes
    .filter((node) => !isValidCapacityBounds(getCapacityMeshNodeBounds(node)))
    .map((node) => node.capacityMeshNodeId)

  expect(topologyPlanningSolver.failed).toBe(false)
  expect(componentMeshNodes.length).toBeGreaterThan(0)
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
