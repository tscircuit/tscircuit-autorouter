import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

export type ModelPoint = { x: number; y: number; z: number }
export type MovementModel = {
  coordinates: readonly number[]
  layers: readonly number[]
  goal: ModelPoint
  goalRadius: number
  misalignment: number
  flip: boolean
  viaCost: number
}
export type ModelEdge = { from: number; to: number; cost: number }

export function createNativeHeuristicSolver(
  model: MovementModel,
): SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "model",
    A: { x: 0, y: 0, z: model.layers[0]! },
    B: model.goal,
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    minDistBetweenEnteringPoints: 0.05,
    obstacleRoutes: [],
    availableZ: [...model.layers],
    futureConnections: [
      {
        connectionName: "future",
        points: [{ x: 0.4, y: 0.4, z: model.layers[0]! }],
      },
    ],
    hyperParameters: {
      MISALIGNED_DIST_PENALTY_FACTOR: model.misalignment,
      FLIP_TRACE_ALIGNMENT_DIRECTION: model.flip,
      COST_ALIGNED_HEURISTIC: true,
    },
    captureSearchDebug: false,
  })
  solver.cellStep = model.goalRadius / Math.SQRT2
  Object.defineProperty(solver, "viaPenaltyDistance", { value: model.viaCost })
  return solver
}

export function createModelNode(point: ModelPoint): Node {
  return {
    ...point,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
}

export function getModelShortestPaths(model: MovementModel): {
  points: ModelPoint[]
  costs: number[]
  edges: ModelEdge[]
} {
  const side = model.coordinates.length
  const plane = side * side
  const points: ModelPoint[] = []
  for (const z of model.layers) {
    for (const y of model.coordinates) {
      for (const x of model.coordinates) points.push({ x, y, z })
    }
  }
  const edges: ModelEdge[] = []
  for (let from = 0; from < points.length; from++) {
    const current = points[from]!
    const layer = Math.floor(from / plane)
    const row = Math.floor((from % plane) / side)
    const column = from % side
    for (let nextLayer = 0; nextLayer < model.layers.length; nextLayer++) {
      if (nextLayer === layer) continue
      edges.push({
        from,
        to: nextLayer * plane + row * side + column,
        cost: model.viaCost,
      })
    }
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const nr = row + dr
        const nc = column + dc
        if (nr < 0 || nr >= side || nc < 0 || nc >= side) continue
        const to = layer * plane + nr * side + nc
        const next = points[to]!
        const dx = Math.abs(next.x - current.x)
        const dy = Math.abs(next.y - current.y)
        const prefersHorizontal = (current.z % 2 === 0) !== model.flip
        edges.push({
          from,
          to,
          cost:
            Math.sqrt(dx * dx + dy * dy) +
            model.misalignment * (prefersHorizontal ? dy : dx),
        })
      }
    }
  }
  const costs = points.map((point) =>
    point.z === model.goal.z &&
    Math.hypot(point.x - model.goal.x, point.y - model.goal.y) <=
      model.goalRadius
      ? 0
      : Infinity,
  )
  const incoming: ModelEdge[][] = points.map(() => [])
  for (const edge of edges) incoming[edge.to]!.push(edge)
  const closed = new Set<number>()
  while (closed.size < points.length) {
    let closest = -1
    for (let index = 0; index < points.length; index++) {
      if (
        !closed.has(index) &&
        (closest === -1 || costs[index]! < costs[closest]!)
      ) {
        closest = index
      }
    }
    if (closest === -1 || !Number.isFinite(costs[closest])) break
    closed.add(closest)
    for (const edge of incoming[closest]!) {
      costs[edge.from] = Math.min(
        costs[edge.from]!,
        edge.cost + costs[closest]!,
      )
    }
  }
  return { points, costs, edges }
}
