import { distance } from "@tscircuit/math-utils"
import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type Point = { x: number; y: number; z: number }
type CacheStorage = {
  closestFuturePointCacheCoordinates?: Float64Array
  closestFuturePointCacheIndices?: Int32Array
}

class LegacyCostReference extends Native {
  override getClosestFutureConnectionPoint(node: Node): Point | null {
    let closest: Point | null = null
    let minimum = Infinity
    for (const point of this.futureConnectionPoints) {
      const candidate =
        distance(node, point) +
        (node.z !== point.z ? this.viaPenaltyDistance : 0)
      if (candidate < minimum) {
        minimum = candidate
        closest = point
      }
    }
    return closest
  }

  override getFutureConnectionPenalty(node: Node, isVia: boolean): number {
    let penalty = 0
    const point = this.getClosestFutureConnectionPoint(node)
    const goalDistance = distance(node, this.B)
    if (point) {
      const pointDistance = distance(node, point)
      if (goalDistance <= pointDistance) return 0
      const maximumDistance =
        this.viaDiameter * this.FUTURE_CONNECTION_PROXIMITY_VD
      const ratio = pointDistance / maximumDistance
      const maximumPenalty = isVia
        ? this.straightLineDistance *
          this.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR
        : this.straightLineDistance *
          this.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR
      penalty = maximumPenalty * Math.exp(-ratio * 5)
    }
    return penalty
  }

  override setNodeCosts(node: Node): void {
    // Independent legacy G/H calls retain the original repeated evaluations.
    node.g = this.computeG(node)
    node.h = this.computeH(node)
    node.f = this.computeF(node.g, node.h)
  }
}

const props: ConstructorParameters<typeof Native>[0] = {
  connectionName: "signal",
  obstacleRoutes: [],
  minDistBetweenEnteringPoints: 0.2,
  bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
  A: { x: -2, y: 0, z: 0 },
  B: { x: 2, y: 0, z: 0 },
  layerCount: 3,
  availableZ: [0, 1, 2],
  futureConnections: [],
  captureSearchDebug: false,
}

test("future costs reuse exact goal distance and allocate the memo only for nonempty futures", (): void => {
  const empty = new Native(structuredClone(props))
  const storage = empty as unknown as CacheStorage
  const query: Node = {
    x: 0,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: { x: -1, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null },
  }
  expect(empty.getClosestFutureConnectionPoint(query)).toBeNull()
  expect(empty.getFutureConnectionPenalty(query, false)).toBe(0)
  empty.setNodeCosts({ ...query })
  expect(storage.closestFuturePointCacheCoordinates).toBeUndefined()
  expect(storage.closestFuturePointCacheIndices).toBeUndefined()

  const points = [
    { x: 0.25, y: 0, z: 0 },
    { x: 1.75, y: 0, z: 0 },
  ]
  empty.futureConnectionPoints = points
  expect(empty.getClosestFutureConnectionPoint(query)).toBe(points[0])
  const coordinates = storage.closestFuturePointCacheCoordinates
  const indices = storage.closestFuturePointCacheIndices
  expect(coordinates).toBeInstanceOf(Float64Array)
  expect(indices).toBeInstanceOf(Int32Array)
  points.length = 0
  expect(empty.getClosestFutureConnectionPoint(query)).toBeNull()
  points.push({ x: 1.75, y: 0, z: 0 }, { x: 0.25, y: 0, z: 0 })
  expect(empty.getClosestFutureConnectionPoint(query)).toBe(points[1])
  expect(storage.closestFuturePointCacheCoordinates).toBe(coordinates)
  expect(storage.closestFuturePointCacheIndices).toBe(indices)
  empty.futureConnectionPoints = []
  expect(empty.getClosestFutureConnectionPoint(query)).toBeNull()
  empty.futureConnectionPoints = [{ x: 0, y: 0, z: 2 }]
  expect(empty.getClosestFutureConnectionPoint(query)).toBe(
    empty.futureConnectionPoints[0],
  )

  for (const futurePoints of [
    [],
    [{ x: -2, y: 0, z: 0 }],
    [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
  ]) {
    for (const flip of [false, true]) {
      const options = {
        ...structuredClone(props),
        futureConnections: [{ connectionName: "future", points: futurePoints }],
      }
      const actual = new Native(structuredClone(options))
      const reference = new LegacyCostReference(structuredClone(options))
      actual.FLIP_TRACE_ALIGNMENT_DIRECTION = flip
      reference.FLIP_TRACE_ALIGNMENT_DIRECTION = flip
      for (const x of [
        -Number.EPSILON,
        -Number.MIN_VALUE,
        -0,
        0,
        Number.MIN_VALUE,
        Number.EPSILON,
        2 - Number.EPSILON,
        2,
        2 + 2 * Number.EPSILON,
        Infinity,
        NaN,
      ]) {
        for (const z of [0, 1, 2]) {
          const node = { ...query, x, z }
          const expected = { ...node }
          actual.setNodeCosts(node)
          reference.setNodeCosts(expected)
          expect(node.g).toBe(expected.g)
          expect(node.h).toBe(expected.h)
          expect(node.f).toBe(expected.f)
          expect(node.parent).toBe(query.parent)
          expect(
            actual.getFutureConnectionPenalty(node, z !== 0),
          ).toBe(reference.getFutureConnectionPenalty(expected, z !== 0))
        }
      }
    }
  }

  for (const captureSearchDebug of [false, true]) {
    for (const futureConnections of [
      [],
      [
        {
          connectionName: "future",
          points: [
            { x: -1, y: 2, z: 0 },
            { x: 1, y: 2, z: 1 },
          ],
        },
      ],
    ]) {
      const options = {
        ...structuredClone(props),
        captureSearchDebug,
        futureConnections,
        obstacleRoutes: [
          {
            connectionName: "barrier",
            traceThickness: 0.1,
            viaDiameter: 0.3,
            vias: [],
            route: [
              { x: 0, y: -1, z: 0 },
              { x: 0, y: 1, z: 0 },
            ],
          },
        ],
      }
      const input = structuredClone(options)
      const actual = new Native(options)
      const reference = new LegacyCostReference(structuredClone(options))
      actual.solve()
      reference.solve()
      expect(actual.solved).toBeTrue()
      expect(actual.solved).toBe(reference.solved)
      expect(actual.failed).toBe(reference.failed)
      expect(actual.error).toBe(reference.error)
      expect(actual.iterations).toBe(reference.iterations)
      expect(actual.solvedPath).toEqual(reference.solvedPath)
      expect([...actual.exploredNodes]).toEqual([...reference.exploredNodes])
      expect(actual.debug_exploredNodesOrdered).toEqual(
        reference.debug_exploredNodesOrdered,
      )
      expect(options).toEqual(input)
    }
  }
})
