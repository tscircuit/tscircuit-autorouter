import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("static via clearance shares layers but preserves exact geometry, query and rebuild identity", () => {
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "route",
    obstacleRoutes: [{
      connectionName: "obstacle",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [{ x: 0.4, y: -1, z: 1 }, { x: 0.4, y: 1, z: 1 }],
      vias: [{ x: -0.8, y: 0 }],
    }],
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 1 },
    layerCount: 4,
  })
  let searches = 0
  for (const index of [solver.obstacleSegmentIndex!, solver.obstacleViaIndex!]) {
    const search = index.search.bind(index)
    index.search = (...args: Parameters<typeof search>): number[] => {
      searches++
      const results = search(...args)
      return results
    }
  }
  const node: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  expect(solver.isNodeTooCloseToObstacle(node, undefined, true)).toBe(false)
  expect(searches).toBe(2)
  for (const z of [1, 2, 3, 0]) {
    expect(solver.isNodeTooCloseToObstacle({ ...node, z }, undefined, true)).toBe(false)
  }
  expect(searches).toBe(2)

  const jittered = { ...node, x: 1e-12 }
  expect(solver.getNodeKey(jittered)).toBe(solver.getNodeKey(node))
  expect(solver.isNodeTooCloseToObstacle(jittered, undefined, true)).toBe(false)
  expect(searches).toBe(4)
  expect(solver.isNodeTooCloseToObstacle(node, 0.3, true)).toBe(true)
  expect(searches).toBe(5)
  expect(solver.isNodeTooCloseToObstacle(node, undefined, true)).toBe(false)
  expect(searches).toBe(7)
  solver.traceThickness = 0.3
  expect(solver.isNodeTooCloseToObstacle(node, undefined, true)).toBe(true)
  expect(searches).toBe(8)
  solver.traceThickness = 0.15
  solver.viaDiameter = 1.3
  expect(solver.isNodeTooCloseToObstacle(node, undefined, true)).toBe(true)
  expect(searches).toBe(10)
  solver.viaDiameter = 0.3
  expect(solver.isNodeTooCloseToObstacle(node, undefined, true)).toBe(false)
  expect(searches).toBe(12)

  const blockedNode = { ...node, x: 0.4 }
  expect(solver.isNodeTooCloseToObstacle(blockedNode, undefined, true)).toBe(true)
  const partialQuery = { segments: solver.obstacleSegments, segmentIds: [] }
  expect(solver.isNodeTooCloseToObstacle(blockedNode, undefined, true, partialQuery)).toBe(false)
  expect(solver.isNodeTooCloseToObstacle(blockedNode, undefined, true)).toBe(true)
  expect(solver.isNodeTooCloseToObstacle(blockedNode, undefined, false)).toBe(false)

  const planarBoundary = { ...node, x: 0.1, z: 1 }
  const planarJitter = { ...planarBoundary, x: planarBoundary.x + 1e-12 }
  expect(solver.getNodeKey(planarBoundary)).toBe(solver.getNodeKey(planarJitter))
  expect(solver.isNodeTooCloseToObstacle(planarBoundary)).toBe(false)
  expect(solver.isNodeTooCloseToObstacle(planarJitter)).toBe(true)

  solver.obstacleRoutes = []
  solver.buildObstacleIndexes()
  expect(solver.isNodeTooCloseToObstacle(blockedNode, undefined, true)).toBe(false)
  solver.obstacleRoutes = [{
    connectionName: "new-obstacle",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [{ x: 0, y: -1, z: 2 }, { x: 0, y: 1, z: 2 }],
    vias: [],
  }]
  solver.buildObstacleIndexes()
  expect(solver.isNodeTooCloseToObstacle(node, undefined, true)).toBe(true)
})
