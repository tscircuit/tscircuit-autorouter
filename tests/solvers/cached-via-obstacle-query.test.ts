import { distance } from "@tscircuit/math-utils"
import { expect, test } from "bun:test"
import Flatbush from "flatbush"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

function createNode(x: number, y: number, z: number): Node {
  return {
    x,
    y,
    z,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
}

function createViaObstacles(): HighDensityIntraNodeRoute[] {
  const obstacles: HighDensityIntraNodeRoute[] = []
  for (let index = 0; index < 48; index++) {
    const x = ((index % 8) - 4) * 0.31
    const y = (Math.floor(index / 8) - 3) * 0.29
    obstacles.push({
      connectionName: `obstacle-${index}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x, y, z: 0 },
        { x, y, z: 1 },
      ],
      vias: [{ x, y }],
    })
  }
  return obstacles
}

function queryViaReference(
  solver: SingleHighDensityRouteSolver,
  node: Node,
  margin: number,
): boolean {
  if (node.parent) {
    for (const via of solver.getViasInNodePath(node.parent)) {
      if (distance(node, via) < solver.viaDiameter / 2 + margin) return true
    }
  }
  if (!solver.obstacleViaIndex) return false
  const proximity = solver.viaDiameter / 2 + solver.traceThickness / 2 + margin
  const ids = solver.obstacleViaIndex.search(
    node.x - proximity,
    node.y - proximity,
    node.x + proximity,
    node.y + proximity,
  )
  for (const id of ids) {
    const via = solver.obstacleVias[id]
    if (via && distance(node, via) < proximity) return true
  }
  return false
}

test("cached via queries preserve fixed index membership, live distances and search overrides", (): void => {
  const params = {
    connectionName: "current",
    obstacleRoutes: createViaObstacles(),
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    A: { x: -2, y: -2, z: 0 },
    B: { x: 2, y: 2, z: 1 },
    layerCount: 4,
    availableZ: [0, 1, 2, 3],
    viaDiameter: 0.3,
    traceThickness: 0.1,
    obstacleMargin: 0.15,
  }
  const solver = new SingleHighDensityRouteSolver(structuredClone(params))
  const index = solver.obstacleViaIndex!
  const storage = index as unknown as { _boxes: Float64Array }
  let searches = 0
  const boxes = storage._boxes
  storage._boxes = new Proxy(boxes, {
    get(target, property): unknown {
      // Every native search reads the root's minimum X once. Counting that
      // access retains native methods and observes actual traversals only.
      if (property === String(target.length - 4)) searches++
      return Reflect.get(target, property, target)
    },
  })
  for (let z = 0; z < 12; z++) {
    solver.isNodeTooCloseToObstacle(createNode(0.2, 0.3, z), 0.15, true)
  }
  expect(searches).toBe(1)
  solver.isNodeTooCloseToObstacle(createNode(0.2, 0.3, 0), 0.16, true)
  expect(searches).toBe(2)
  solver.isNodeTooCloseToObstacle(createNode(0.2, 0.3, 1), 0.15, true)
  expect(searches).toBe(2)
  solver.isNodeTooCloseToObstacle(
    createNode(0.2 + Number.EPSILON, 0.3, 1),
    0.15,
    true,
  )
  expect(searches).toBe(3)
  storage._boxes = boxes

  let seed = 37
  const random = (): number => {
    const product = Math.imul(seed, 1664525)
    const nextSeed = (product + 1013904223) >>> 0
    seed = nextSeed
    return seed / 2 ** 32
  }
  for (let query = 0; query < 800; query++) {
    const x = query % 5 === 0 ? 0.2 : (Math.floor(random() * 32) - 16) * 0.05
    const y = query % 5 === 0 ? 0.3 : (Math.floor(random() * 32) - 16) * 0.05
    const node = createNode(x, y, query % 4)
    const margin = [0, 0.05, 0.15, 0.2][query % 4]!
    if (query % 17 === 0) {
      const via = solver.obstacleVias[query % solver.obstacleVias.length]!
      via.x = x
      via.y = y
    }
    if (query % 23 === 0) {
      solver.obstacleVias = solver.obstacleVias.map((via) => ({ ...via }))
    }
    if (query % 11 === 0) {
      solver.viaDiameter = query % 22 === 0 ? 0.3 : 0.6
      solver.traceThickness = query % 33 === 0 ? 0.1 : 0.2
    }
    if (query % 31 === 0) {
      node.parent = createNode(x, y, 0)
      node.parent.parent = createNode(x, y, 1)
    }
    const expected = queryViaReference(solver, node, margin)
    for (let repeat = 0; repeat < 3; repeat++) {
      expect(solver.isNodeTooCloseToObstacle(node, margin, true)).toBe(expected)
    }
  }

  const point = createNode(0.123, 0.456, 0)
  solver.obstacleVias = [{ x: point.x, y: point.y }]
  const replacement = new Flatbush(2)
  replacement.add(point.x, point.y, point.x, point.y)
  replacement.add(point.x + 0.01, point.y, point.x + 0.01, point.y)
  replacement.finish()
  solver.obstacleViaIndex = replacement
  expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(true)
  solver.obstacleVias[0]!.x = 10
  expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(false)
  solver.obstacleVias[0]!.x = point.x
  expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(true)

  let overriddenSearches = 0
  const originalSearch = replacement.search
  try {
    replacement.search = (
      ..._args: Parameters<typeof originalSearch>
    ): number[] => {
      overriddenSearches++
      const ids = overriddenSearches % 2 === 0 ? [0] : []
      return ids
    }
    expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(false)
    expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(true)
    expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(false)
    expect(overriddenSearches).toBe(3)
  } finally {
    replacement.search = originalSearch
  }
  expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(true)
  const originalCollectContained = Flatbush.prototype._collectContained
  let overriddenCollections = 0
  try {
    Flatbush.prototype._collectContained = (
      ...args: Parameters<typeof originalCollectContained>
    ): void => {
      overriddenCollections++
      const results = args[4]
      if (overriddenCollections % 2 === 0) results.push(0)
      return
    }
    expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(false)
    expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(true)
    expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(false)
    expect(overriddenCollections).toBe(3)
  } finally {
    Flatbush.prototype._collectContained = originalCollectContained
  }
  expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(true)
  replacement.add(point.x, point.y, point.x, point.y)
  expect(() => solver.isNodeTooCloseToObstacle(point, 0.1, true)).toThrow(
    "Data not yet indexed - call index.finish().",
  )
  solver.obstacleRoutes = []
  solver.buildObstacleIndexes()
  expect(solver.isNodeTooCloseToObstacle(point, 0.1, true)).toBe(false)

  const segmentParams = {
    ...params,
    obstacleRoutes: [
      {
        connectionName: "segment-obstacle",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: -0.4, y: 0, z: 0 },
          { x: 0.4, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
  }
  const segmentTrial = new SingleHighDensityRouteSolver(
    structuredClone(segmentParams),
  )
  const segmentReference = new SingleHighDensityRouteSolver(
    structuredClone(segmentParams),
  )
  const referenceSegmentIndex = segmentReference.obstacleSegmentIndex!
  const directSegmentSearch =
    referenceSegmentIndex.search.bind(referenceSegmentIndex)
  referenceSegmentIndex.search = (
    ...args: Parameters<typeof directSegmentSearch>
  ): number[] => {
    const ids = directSegmentSearch(...args)
    return ids
  }
  const segmentStorage = segmentTrial.obstacleSegmentIndex! as unknown as {
    _boxes: Float64Array
  }
  const segmentBoxes = segmentStorage._boxes
  let segmentSearches = 0
  segmentStorage._boxes = new Proxy(segmentBoxes, {
    get(target, property): unknown {
      if (property === String(target.length - 4)) segmentSearches++
      return Reflect.get(target, property, target)
    },
  })
  for (let z = 0; z < 12; z++) {
    const node = createNode(0, 0.4, z)
    expect(segmentTrial.isNodeTooCloseToObstacle(node, 0.15, true)).toBe(
      segmentReference.isNodeTooCloseToObstacle(node, 0.15, true),
    )
  }
  expect(segmentSearches).toBe(1)
  segmentStorage._boxes = segmentBoxes
  for (let query = 0; query < 300; query++) {
    const x = ((query % 13) - 6) * 0.05
    const y = ((query % 11) - 5) * 0.05
    const node = createNode(x, y, query % 4)
    const margin = [0, 0.05, 0.15][query % 3]!
    if (query % 19 === 0) {
      for (const routeSolver of [segmentTrial, segmentReference]) {
        const segment = routeSolver.obstacleSegments[0]!
        segment.A.x = x
        segment.A.y = y
        segment.deltaX = query % 38 === 0 ? 0 : 0.8
        segment.lengthSquared = segment.deltaX ** 2
      }
    }
    expect(segmentTrial.isNodeTooCloseToObstacle(node, margin, true)).toBe(
      segmentReference.isNodeTooCloseToObstacle(node, margin, true),
    )
  }

  for (const Solver of [
    SingleHighDensityRouteSolver,
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  ]) {
    const trial = new Solver(structuredClone(params))
    const reference = new Solver(structuredClone(params))
    const referenceIndex = reference.obstacleViaIndex!
    const search = referenceIndex.search.bind(referenceIndex)
    referenceIndex.search = (...args: Parameters<typeof search>): number[] => {
      const ids = search(...args)
      return ids
    }
    trial.solve()
    reference.solve()
    const state = (routeSolver: SingleHighDensityRouteSolver): object => ({
      solved: routeSolver.solved,
      failed: routeSolver.failed,
      error: routeSolver.error,
      iterations: routeSolver.iterations,
      progress: routeSolver.progress,
      solvedPath: routeSolver.solvedPath,
      exploredNodes: [...routeSolver.exploredNodes],
      candidates: routeSolver.candidates.getTopN(1000),
    })
    expect(state(trial)).toEqual(state(reference))
  }
})
