import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type PlanarObstacleQuery = ReturnType<
  SingleHighDensityRouteSolver["getPlanarObstacleQuery"]
>

// Frozen neighbor generation from before via checks were shared across layers.
function getNeighborsWithPerLayerViaChecks(
  solver: SingleHighDensityRouteSolver,
  node: Node,
): Node[] {
  const neighbors: Node[] = []
  let sharedPlanarObstacleQuery: PlanarObstacleQuery | undefined
  let queriedPlanarNeighbors = false

  const { maxX, minX, maxY, minY } = solver.bounds

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      if (x === 0 && y === 0) continue

      const neighbor: Node = {
        x: Math.max(minX, Math.min(node.x + x * solver.cellStep, maxX)),
        y: Math.max(minY, Math.min(node.y + y * solver.cellStep, maxY)),
        z: node.z,
        g: node.g,
        h: node.h,
        f: node.f,
        parent: node,
      }

      const neighborKey = solver.getNodeKey(neighbor)

      if (solver.exploredNodes.has(neighborKey)) {
        continue
      }

      if (!queriedPlanarNeighbors) {
        sharedPlanarObstacleQuery = solver.getPlanarNeighborObstacleQuery(node)
        queriedPlanarNeighbors = true
      }
      const planarObstacleQuery = solver.getPlanarObstacleQuery(
        neighbor,
        sharedPlanarObstacleQuery,
        neighborKey,
      )
      if (
        solver.isNodeTooCloseToObstacle(
          neighbor,
          undefined,
          false,
          planarObstacleQuery,
        )
      ) {
        if (solver.debugEnabled) {
          solver.debug_nodesTooCloseToObstacle.add(neighborKey)
        }
        solver.exploredNodes.add(neighborKey)
        continue
      }

      if (solver.isNodeTooCloseToEdge(neighbor, false)) {
        solver.exploredNodes.add(neighborKey)
        continue
      }

      if (
        solver.doesPathToParentIntersectObstacle(neighbor, planarObstacleQuery)
      ) {
        if (solver.debugEnabled) {
          solver.debug_nodePathToParentIntersectsObstacle.add(neighborKey)
        }
        solver.exploredNodes.add(neighborKey)
        continue
      }

      solver.setNodeCosts(neighbor)

      neighbors.push(neighbor)
    }
  }

  // Add via neighbors for all other layers (a via can connect any layer to any other layer)
  for (const newZ of solver.availableZ) {
    if (newZ === node.z) continue

    const viaNeighbor: Node = {
      x: node.x,
      y: node.y,
      z: newZ,
      g: node.g,
      h: node.h,
      f: node.f,
      parent: node,
    }

    if (
      !solver.exploredNodes.has(solver.getNodeKey(viaNeighbor)) &&
      !solver.isNodeTooCloseToObstacle(
        viaNeighbor,
        solver.viaDiameter / 2 + solver.obstacleMargin / 2,
        true,
      ) &&
      !solver.isNodeTooCloseToEdge(viaNeighbor, true)
    ) {
      solver.setNodeCosts(viaNeighbor)

      neighbors.push(viaNeighbor)
    }
  }

  return neighbors
}

class PerLayerViaSolver extends SingleHighDensityRouteSolver {
  override getNeighbors(node: Node): Node[] {
    return getNeighborsWithPerLayerViaChecks(this, node)
  }
}

class PerLayerFutureViaSolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  override getNeighbors(node: Node): Node[] {
    return getNeighborsWithPerLayerViaChecks(this, node)
  }
}

function createObstacles(): HighDensityIntraNodeRoute[] {
  return Array.from({ length: 12 }, (_, index): HighDensityIntraNodeRoute => {
    const x = ((index % 4) - 1.5) * 0.5
    const y = (Math.floor(index / 4) - 1) * 0.5
    const z = index % 4
    return {
      connectionName: index % 5 === 0 ? "connected" : `obstacle-${index}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x, y, z },
        { x: x + 0.1, y: y + 0.15, z },
      ],
      vias: index % 3 === 0 ? [{ x: x + 0.2, y }] : [],
    }
  })
}

function createNode(x: number, y: number, z: number): Node {
  return {
    x,
    y,
    z,
    g: 2,
    h: 3,
    f: 5,
    parent: null,
  }
}

test("via neighbors reuse full-stack clearance without changing neighbors, costs, or search results", (): void => {
  let comparedNeighborhoods = 0
  let feasibleViaNeighborhoods = 0
  for (const [SharedSolver, ReferenceSolver] of [
    [SingleHighDensityRouteSolver, PerLayerViaSolver],
    [
      SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
      PerLayerFutureViaSolver,
    ],
  ] as const) {
    for (const layerCount of [2, 4]) {
      const options = {
        connectionName: "current",
        obstacleRoutes: createObstacles(),
        minDistBetweenEnteringPoints: 0.1,
        bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
        A: { x: -2, y: -1, z: 0 },
        B: { x: 2, y: 1, z: layerCount - 1 },
        layerCount,
        availableZ: Array.from(
          { length: layerCount },
          (_, index): number => index,
        ),
        traceThickness: 0.1,
        obstacleMargin: 0.1,
        viaDiameter: 0.3,
        futureConnections: [
          {
            connectionName: "future",
            points: [
              { x: -1, y: 1.25, z: 0 },
              { x: 1, y: 1.25, z: 1 },
            ],
          },
        ],
        connMap: {
          areIdsConnected: (_left: string, right: string): boolean =>
            right === "connected",
        } as any,
      }
      const shared = new SharedSolver(options)
      const reference = new ReferenceSolver(options)
      for (const [x, y] of [
        [-2, -2],
        [-1.95, 0],
        [-1.25, -1.25],
        [0, 0],
        [0.8, 0.25],
        [0, 1.25],
        [1.25, 1.25],
      ]) {
        for (let z = 0; z < layerCount; z++) {
          for (const previousViaOffset of [undefined, 0, 0.75]) {
            for (const exploredViaLayers of [[], [0], [0, 1, 2, 3]]) {
              shared.exploredNodes.clear()
              reference.exploredNodes.clear()
              shared.debug_nodesTooCloseToObstacle.clear()
              reference.debug_nodesTooCloseToObstacle.clear()
              shared.debug_nodePathToParentIntersectsObstacle.clear()
              reference.debug_nodePathToParentIntersectsObstacle.clear()
              const node = createNode(x, y, z)
              if (previousViaOffset !== undefined) {
                node.parent = createNode(x + previousViaOffset, y, z)
                node.parent.parent = createNode(
                  x + previousViaOffset,
                  y,
                  (z + 1) % layerCount,
                )
              }
              for (const exploredZ of exploredViaLayers) {
                const key = shared.getNodeKey({ ...node, z: exploredZ })
                shared.exploredNodes.add(key)
                reference.exploredNodes.add(key)
              }
              const neighbors = shared.getNeighbors(node)
              expect(neighbors).toEqual(reference.getNeighbors(node))
              expect([...shared.exploredNodes]).toEqual([
                ...reference.exploredNodes,
              ])
              expect([...shared.debug_nodesTooCloseToObstacle]).toEqual([
                ...reference.debug_nodesTooCloseToObstacle,
              ])
              expect([
                ...shared.debug_nodePathToParentIntersectsObstacle,
              ]).toEqual([
                ...reference.debug_nodePathToParentIntersectsObstacle,
              ])
              if (neighbors.some((neighbor): boolean => neighbor.z !== node.z))
                feasibleViaNeighborhoods++
              comparedNeighborhoods++
            }
          }
        }
      }
      const solvedShared = new SharedSolver(options)
      const solvedReference = new ReferenceSolver(options)
      solvedShared.solve()
      solvedReference.solve()
      expect(solvedShared.solved).toBeTrue()
      expect(solvedShared.solved).toBe(solvedReference.solved)
      expect(solvedShared.failed).toBe(solvedReference.failed)
      expect(solvedShared.iterations).toBe(solvedReference.iterations)
      expect(solvedShared.solvedPath).toEqual(solvedReference.solvedPath)
    }
  }
  expect(comparedNeighborhoods).toBe(756)
  expect(feasibleViaNeighborhoods).toBeGreaterThan(0)

  for (const [SharedSolver, ReferenceSolver] of [
    [SingleHighDensityRouteSolver, PerLayerViaSolver],
    [
      SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
      PerLayerFutureViaSolver,
    ],
  ] as const) {
    const options = {
      connectionName: "query-count",
      obstacleRoutes: createObstacles(),
      minDistBetweenEnteringPoints: 0.1,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      A: { x: -2, y: -1, z: 0 },
      B: { x: 2, y: 1, z: 3 },
      layerCount: 4,
      availableZ: [0, 1, 2, 3],
      futureConnections: [
        {
          connectionName: "future",
          points: [
            { x: -1, y: 1.25, z: 0 },
            { x: 1, y: 1.25, z: 1 },
          ],
        },
      ],
    }
    const shared = new SharedSolver(options)
    const reference = new ReferenceSolver(options)
    let sharedSearches = 0
    let referenceSearches = 0
    const sharedIndex = shared.obstacleSegmentIndex!
    const referenceIndex = reference.obstacleSegmentIndex!
    const sharedSearch = sharedIndex.search.bind(sharedIndex)
    const referenceSearch = referenceIndex.search.bind(referenceIndex)
    sharedIndex.search = (
      ...args: Parameters<typeof sharedSearch>
    ): number[] => {
      sharedSearches++
      return sharedSearch(...args)
    }
    referenceIndex.search = (
      ...args: Parameters<typeof referenceSearch>
    ): number[] => {
      referenceSearches++
      return referenceSearch(...args)
    }
    const node = createNode(-1.25, -1.25, 0)
    expect(shared.getNeighbors(node)).toEqual(reference.getNeighbors(node))
    expect(sharedSearches).toBe(1)
    expect(referenceSearches).toBe(3)
    for (const z of [1, 2, 3])
      shared.exploredNodes.add(shared.getNodeKey({ ...node, z }))
    sharedSearches = 0
    shared.getNeighbors(node)
    expect(sharedSearches).toBe(0)
  }
})
