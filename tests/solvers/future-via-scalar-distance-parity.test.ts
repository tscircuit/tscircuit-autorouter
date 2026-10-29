import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type Point = { x: number; y: number; z: number }

class OriginalFutureViaSolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  override isViaTooCloseToFutureConnectionTrace(node: Node): boolean {
    const requiredDistance =
      this.viaDiameter / 2 +
      this.traceThickness / 2 +
      this.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE
    for (const segment of this.getFutureConnectionSegments()) {
      if (
        pointToSegmentDistance(node, segment.start, segment.end) <
        requiredDistance
      ) {
        return true
      }
    }
    return false
  }
}

function adjacentFloat(value: number, direction: -1 | 1): number {
  if (value === 0) return direction * Number.MIN_VALUE
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  const bits = view.getBigUint64(0)
  view.setBigUint64(0, bits + BigInt(value > 0 ? direction : -direction))
  return view.getFloat64(0)
}

function createNode(point: Point): Node {
  return {
    ...point,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
}

test("future via scalar distances preserve original strict boundaries and complete search outputs", (): void => {
  const params = {
    connectionName: "current",
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    A: { x: 1, y: 1, z: 0 },
    B: { x: 9, y: 9, z: 0 },
    traceThickness: 0,
    viaDiameter: 0,
    obstacleRoutes: [],
    captureSearchDebug: true,
  }
  const scalar = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
    params,
  )
  const original = new OriginalFutureViaSolver(params)
  let state = 19
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
  for (let index = 0; index < 600; index++) {
    const scale = [1e-200, 1e-120, 0.01, 1, 1e4, 1e120, 1e160][index % 7]!
    const start = {
      x: (random() - 0.5) * scale,
      y: (random() - 0.5) * scale,
      z: 0,
    }
    const end =
      index % 13 === 0
        ? { ...start }
        : {
            x: (random() - 0.5) * scale,
            y: (random() - 0.5) * scale,
            z: 1,
          }
    const node = createNode({
      x: (random() - 0.5) * scale,
      y: (random() - 0.5) * scale,
      z: index % 4,
    })
    const segments = [{ connectionName: "future", start, end }]
    scalar.futureConnectionSegmentsCache = segments
    original.futureConnectionSegmentsCache = segments
    const distance = pointToSegmentDistance(node, start, end)
    for (const clearance of [
      adjacentFloat(distance, -1),
      distance,
      adjacentFloat(distance, 1),
    ]) {
      scalar.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = clearance
      original.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = clearance
      expect(scalar.isViaTooCloseToFutureConnectionTrace(node)).toBe(
        original.isViaTooCloseToFutureConnectionTrace(node),
      )
    }
    // Cached segment endpoints remain live references in the existing API.
    end.x = start.x
    end.y = start.y
    expect(scalar.isViaTooCloseToFutureConnectionTrace(node)).toBe(
      original.isViaTooCloseToFutureConnectionTrace(node),
    )
  }

  for (const layerCount of [1, 2, 4]) {
    const options = {
      ...params,
      viaDiameter: 0.3,
      traceThickness: 0.15,
      obstacleMargin: 0.15,
      layerCount,
      B: { ...params.B, z: layerCount - 1 },
      futureConnections: [
        {
          connectionName: "future",
          points: [
            { x: 2, y: 8, z: 0 },
            { x: 8, y: 2, z: layerCount - 1 },
          ],
        },
      ],
    }
    const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
      options,
    )
    const reference = new OriginalFutureViaSolver(options)
    solver.solve()
    reference.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.solvedPath).toEqual(reference.solvedPath)
    expect(solver.iterations).toBe(reference.iterations)
    expect(solver.debug_exploredNodesOrdered).toEqual(
      reference.debug_exploredNodesOrdered,
    )
    expect(solver.debug_nodesTooCloseToObstacle).toEqual(
      reference.debug_nodesTooCloseToObstacle,
    )
    expect(solver.debug_nodePathToParentIntersectsObstacle).toEqual(
      reference.debug_nodePathToParentIntersectsObstacle,
    )
  }
})
