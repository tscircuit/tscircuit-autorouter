import { describe, expect, test } from "bun:test"
import {
  DirectionWithCollisionInfo3d,
  expandMultilayerIjumpNeighbors,
  filterValidOrthoDirections,
  MultilayerIjumpParams,
  Node3d,
} from "../lib/solvers/multilayer-ijump/MultilayerIjump"

const DEFAULT_PARAMS: MultilayerIjumpParams = {
  obstacleMargin: 0.15,
  viaDiameter: 0.6,
  defaultGoalViaMargin: 0.1,
  gridStep: 0.1,
  largestMargin: 0.45,
  marginsWithCosts: [
    { margin: 0.15, enterCost: 0, travelCostFactor: 1 },
    { margin: 0.3, enterCost: 1, travelCostFactor: 1 },
  ],
}

describe("MultilayerIjump wild trace jump regression (#743 / autorouting#92)", () => {
  test("does not push negative backward jump when wallDistance is Infinity and goal is behind travelDir", () => {
    const node: Node3d = {
      x: 5,
      y: 2,
      l: 0,
      obstacleHit: { minX: 4, minY: 2.5, maxX: 6, maxY: 3.5, l: 0 },
    }
    const goalPoint = { x: 1, y: 8, l: 0 }
    const rightDir: DirectionWithCollisionInfo3d = {
      dx: 1,
      dy: 0,
      dl: 0,
      wallDistance: Infinity,
      obstacleHit: null,
    }
    const overcomeMap = new Map<DirectionWithCollisionInfo3d, number | null>([
      [rightDir, 1.2],
    ])

    const neighbors = expandMultilayerIjumpNeighbors({
      node,
      goalPoint,
      forwardDir: { dx: 0, dy: 1, dl: 0 },
      collisionDirs: [rightDir],
      overcomeDistanceByDir: overcomeMap,
      params: DEFAULT_PARAMS,
    })

    // Only positive obstacle-overcoming margin steps should be generated;
    // no backward jump to x = 1 (travelDistance = -4) may be emitted.
    expect(neighbors.length).toBe(2)
    for (const neighbor of neighbors) {
      expect(neighbor.travelDistance).toBeGreaterThan(0)
      expect(neighbor.x).toBeGreaterThan(node.x)
    }
  })

  test("allows goal-aligned jump in Infinity branch when goal is strictly ahead in travelDir", () => {
    const node: Node3d = {
      x: 2,
      y: 2,
      l: 0,
      obstacleHit: { minX: 1, minY: 2.5, maxX: 3, maxY: 3.5, l: 0 },
    }
    const goalPoint = { x: 9, y: 8, l: 0 }
    const rightDir: DirectionWithCollisionInfo3d = {
      dx: 1,
      dy: 0,
      dl: 0,
      wallDistance: Infinity,
      obstacleHit: null,
    }
    const overcomeMap = new Map<DirectionWithCollisionInfo3d, number | null>([
      [rightDir, 1.0],
    ])

    const neighbors = expandMultilayerIjumpNeighbors({
      node,
      goalPoint,
      forwardDir: { dx: 0, dy: 1, dl: 0 },
      collisionDirs: [rightDir],
      overcomeDistanceByDir: overcomeMap,
      params: DEFAULT_PARAMS,
    })

    const xs = neighbors.map((n) => n.x)
    expect(xs).toContain(9)
  })

  test("filters forward direction using current node.obstacleHit rather than parent.obstacleHit", () => {
    const orthoDirs = [
      { dx: 0, dy: 1, dl: 0 },
      { dx: 1, dy: 0, dl: 0 },
      { dx: 0, dy: -1, dl: 0 },
      { dx: -1, dy: 0, dl: 0 },
    ]
    const forwardDir = { dx: 0, dy: 1, dl: 0 }

    const clearedChild: Node3d = {
      x: 3,
      y: 2,
      l: 0,
      obstacleHit: null,
      parent: {
        x: 2,
        y: 2,
        l: 0,
        obstacleHit: { minX: 1, minY: 2.5, maxX: 4, maxY: 3.5, l: 0 },
      },
    }

    const allowedForCleared = filterValidOrthoDirections(
      orthoDirs,
      forwardDir,
      clearedChild,
    )
    expect(allowedForCleared).toContainEqual({ dx: 0, dy: 1, dl: 0 })

    const blockedNode: Node3d = {
      x: 2,
      y: 2,
      l: 0,
      obstacleHit: { minX: 1, minY: 2.5, maxX: 4, maxY: 3.5, l: 0 },
    }
    const allowedForBlocked = filterValidOrthoDirections(
      orthoDirs,
      forwardDir,
      blockedNode,
    )
    expect(allowedForBlocked).not.toContainEqual({ dx: 0, dy: 1, dl: 0 })
  })
})
