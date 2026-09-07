import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

type PlanarQuery = ReturnType<SingleHighDensityRouteSolver["getPlanarObstacleQuery"]>

class PartialQuerySolver extends SingleHighDensityRouteSolver {
  override getPlanarNeighborObstacleQuery(node: Node): PlanarQuery {
    const query = super.getPlanarNeighborObstacleQuery(node)
    if (query) {
      query.segmentIds = []
    }
    return query
  }

  override getPlanarObstacleQuery(node: Node): PlanarQuery {
    const query = super.getPlanarObstacleQuery(node)
    if (query) {
      query.segmentIds = []
    }
    return query
  }
}

test("planar clearance cache accepts complete base queries and preserves partial query overrides", () => {
  const options = {
    connectionName: "route",
    obstacleRoutes: [{
      connectionName: "obstacle",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [{ x: 0.4, y: -1, z: 0 }, { x: 0.4, y: 1, z: 0 }],
      vias: [{ x: 1, y: 1 }],
    }],
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 1 },
  }
  const solver = new SingleHighDensityRouteSolver(options)
  const parent: Node = { x: 0.35, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  const blocked = { ...parent, x: 0.4, parent }
  expect(solver.isNodeTooCloseToObstacle(blocked)).toBe(true)
  const shared = solver.getPlanarNeighborObstacleQuery(parent)!
  expect(solver.isNodeTooCloseToObstacle(blocked, undefined, false, shared)).toBe(true)

  const partial = { segments: solver.obstacleSegmentsByLayer.get(0)!, segmentIds: [] }
  expect(solver.isNodeTooCloseToObstacle(blocked, undefined, false, partial)).toBe(false)
  const editedIds = solver.getPlanarNeighborObstacleQuery(parent)!
  expect(editedIds.segmentIds.length).toBeGreaterThan(0)
  editedIds.segmentIds[0] = -1
  expect(solver.isNodeTooCloseToObstacle(blocked, undefined, false, editedIds)).toBe(false)
  const replacedIds = solver.getPlanarNeighborObstacleQuery(parent)!
  replacedIds.segmentIds = []
  expect(solver.isNodeTooCloseToObstacle(blocked, undefined, false, replacedIds)).toBe(false)
  const replacedSegments = solver.getPlanarNeighborObstacleQuery(parent)!
  replacedSegments.segments = []
  expect(solver.isNodeTooCloseToObstacle(blocked, undefined, false, replacedSegments)).toBe(false)
  const farParent = { ...parent, x: -1.5 }
  const farQuery = solver.getPlanarNeighborObstacleQuery(farParent)!
  // A base-created query outside the endpoint box is also partial for this node.
  expect(solver.isNodeTooCloseToObstacle(blocked, undefined, false, farQuery)).toBe(false)
  const wrongLayer = { ...blocked, z: 1 }
  expect(solver.isNodeTooCloseToObstacle(wrongLayer, undefined, false, shared)).toBe(false)

  const overridden = new PartialQuerySolver(options)
  expect(overridden.isNodeTooCloseToObstacle(blocked)).toBe(true)
  for (const query of [
    overridden.getPlanarNeighborObstacleQuery(parent),
    overridden.getPlanarObstacleQuery(blocked),
  ]) {
    expect(overridden.isNodeTooCloseToObstacle(blocked, undefined, false, query)).toBe(false)
  }

  const clearParent = { ...parent, x: -1, y: -1 }
  let viaSearches = 0
  const search = solver.obstacleViaIndex!.search.bind(solver.obstacleViaIndex!)
  solver.obstacleViaIndex!.search = (...args: Parameters<typeof search>): number[] => {
    viaSearches++
    const result = search(...args)
    return result
  }
  const firstNeighbors = solver.getNeighbors(clearParent)
  const firstSearches = viaSearches
  expect(firstSearches).toBeGreaterThan(0)
  expect(solver.getNeighbors(clearParent)).toEqual(firstNeighbors)
  expect(viaSearches).toBe(firstSearches)

  const clear = { ...parent, x: 0, parent }
  expect(solver.isNodeTooCloseToObstacle(clear)).toBe(false)
  const completeForDefaultMargin = solver.getPlanarObstacleQuery(clear)!
  // The old smaller query cannot establish a complete result at larger margin.
  expect(solver.isNodeTooCloseToObstacle(clear, 0.4, false, completeForDefaultMargin)).toBe(true)
  solver.traceThickness = 0.3
  expect(solver.isNodeTooCloseToObstacle(clear)).toBe(true)
  solver.traceThickness = 0.15
  solver.obstacleRoutes = []
  solver.buildObstacleIndexes()
  expect(solver.isNodeTooCloseToObstacle(blocked)).toBe(false)
})
