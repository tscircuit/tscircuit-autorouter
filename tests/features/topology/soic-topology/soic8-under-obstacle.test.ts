import { getBoundFromCenteredRect } from "@tscircuit/math-utils"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { RemoveMeshNodeOverlappingWithUnmarkedObstacle } from "lib/solvers/BgaTopologyGeneratorSolver/RemoveMeshNodeOverlappingSolver"
import { SoicTopologyGeneratorSolver } from "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import srjInput from "./soic8-under-obstacle.srj.json" with { type: "json" }

const srj = srjInput as SimpleRouteJson
const componentId = "U_SOIC8"
const underObstacleId = "under_soic_top_obstacle"
const componentBounds = {
  __type: "rect" as const,
  minX: -1.16,
  maxX: 1.16,
  minY: -1.44,
  maxY: 1.44,
}

function createSolvedSoicSolver(
  inputSrj: SimpleRouteJson = srj,
): SoicTopologyGeneratorSolver {
  const solver = new SoicTopologyGeneratorSolver({
    inputSrj: structuredClone(inputSrj),
    detectedComponent: {
      componentId,
      componentKind: "soic",
      bounds: componentBounds,
    },
    obstacleMargin: srj.defaultObstacleMargin,
    viaDiameter: srj.minViaPadDiameter,
  })

  solver.solve()
  return solver
}

function createSrjWithUnderObstacleZLayers(): SimpleRouteJson {
  return {
    ...structuredClone(srj),
    obstacles: srj.obstacles.map((obstacle: Obstacle): Obstacle => {
      if (obstacle.obstacleId !== underObstacleId) {
        return obstacle
      }

      return {
        ...obstacle,
        layers: ["bottom"],
        zLayers: [0],
      }
    }),
  }
}

function doBoundsHavePositiveAreaOverlap(
  firstBounds: ReturnType<typeof getBoundFromCenteredRect>,
  secondBounds: ReturnType<typeof getBoundFromCenteredRect>,
): boolean {
  const overlapWidth =
    Math.min(firstBounds.maxX, secondBounds.maxX) -
    Math.max(firstBounds.minX, secondBounds.minX)
  const overlapHeight =
    Math.min(firstBounds.maxY, secondBounds.maxY) -
    Math.max(firstBounds.minY, secondBounds.minY)

  return overlapWidth > 1e-9 && overlapHeight > 1e-9
}

function getObstacleAvailableZ(obstacle: Obstacle): number[] {
  if (obstacle.zLayers && obstacle.zLayers.length > 0) {
    return obstacle.zLayers
  }

  return obstacle.layers.map((layerName: string): number =>
    mapLayerNameToZ(layerName, srj.layerCount),
  )
}

function doesNodeOverlapObstacleIn3d(
  node: CapacityMeshNode,
  obstacle: Obstacle,
): boolean {
  const obstacleAvailableZ = getObstacleAvailableZ(obstacle)
  const sharesLayer = node.availableZ.some((z: number): boolean =>
    obstacleAvailableZ.includes(z),
  )

  return (
    sharesLayer &&
    doBoundsHavePositiveAreaOverlap(
      getBoundFromCenteredRect(node),
      getBoundFromCenteredRect(obstacle),
    )
  )
}

test("soic8 topology handles a foreign obstacle under the package body in 3d", () => {
  const solver = createSolvedSoicSolver()
  const obstacle = srj.obstacles.find(
    (candidate: Obstacle): boolean => candidate.obstacleId === underObstacleId,
  )

  expect(obstacle).toBeDefined()
  expect(srj.layerCount).toBe(2)
  expect(getObstacleAvailableZ(obstacle!)).toEqual([0])
  const nodesOverlappingObstacleIn3d = solver
    .getOutput()
    .routingRegions.filter((node: CapacityMeshNode): boolean => {
      if (node._containsObstacle) return false

      return doesNodeOverlapObstacleIn3d(node, obstacle!)
    })

  expect(nodesOverlappingObstacleIn3d).toHaveLength(0)
})

test("soic8 topology keeps bottom-layer routing below a top-only obstacle", () => {
  const solver = createSolvedSoicSolver()
  const obstacle = srj.obstacles.find(
    (candidate: Obstacle): boolean => candidate.obstacleId === underObstacleId,
  )

  expect(obstacle).toBeDefined()
  const bottomLayerNodesUnderObstacle = solver
    .getOutput()
    .routingRegions.filter((node: CapacityMeshNode): boolean => {
      if (node._containsObstacle) return false
      if (!node.availableZ.includes(1)) return false

      return doBoundsHavePositiveAreaOverlap(
        getBoundFromCenteredRect(node),
        getBoundFromCenteredRect(obstacle!),
      )
    })

  expect(bottomLayerNodesUnderObstacle.length).toBeGreaterThan(0)
})

test("soic8 topology uses obstacle zLayers before named layers", () => {
  const srjWithZLayers = createSrjWithUnderObstacleZLayers()
  const solver = createSolvedSoicSolver(srjWithZLayers)
  const obstacle = srjWithZLayers.obstacles.find(
    (candidate: Obstacle): boolean => candidate.obstacleId === underObstacleId,
  )

  expect(obstacle).toBeDefined()
  expect(obstacle!.layers).toEqual(["bottom"])
  expect(getObstacleAvailableZ(obstacle!)).toEqual([0])
  const nodesOverlappingObstacleIn3d = solver
    .getOutput()
    .routingRegions.filter((node: CapacityMeshNode): boolean => {
      if (node._containsObstacle) return false

      return doesNodeOverlapObstacleIn3d(node, obstacle!)
    })

  expect(nodesOverlappingObstacleIn3d).toHaveLength(0)
})

test("mesh node remover keeps same-layer nodes that only touch obstacle edges", () => {
  const solver = new RemoveMeshNodeOverlappingWithUnmarkedObstacle({
    layerCount: 2,
    meshNodes: [
      {
        capacityMeshNodeId: "touching-node",
        center: { x: -0.5, y: 0 },
        width: 1,
        height: 1,
        layer: "z0",
        availableZ: [0],
      },
    ],
    obstacles: [
      {
        obstacleId: "touching-obstacle",
        type: "rect",
        layers: ["top"],
        center: { x: 0.5, y: 0 },
        width: 1,
        height: 1,
        connectedTo: [],
      },
    ],
  })

  solver.solve()
  expect(solver.getOutput()).toHaveLength(1)
})

test("soic8 topology under-obstacle snapshot", () => {
  const solver = createSolvedSoicSolver()
  const svg = getSvgFromGraphicsObject(solver.visualize(), {
    backgroundColor: "white",
  })

  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
