import { expect, test } from "bun:test"
import {
  type Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteCandidateQueue } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteCandidateQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

function createSolver(): SingleHighDensityRouteSolver {
  return new SingleHighDensityRouteSolver({
    connectionName: "current",
    obstacleRoutes: [
      {
        connectionName: "wall",
        traceThickness: 0.1,
        viaDiameter: 0.2,
        route: [
          { x: 1, y: 0.2, z: 0 },
          { x: 1, y: 1.6, z: 0 },
        ],
        vias: [],
      },
    ],
    futureConnections: [
      {
        connectionName: "future",
        points: [{ x: 1.5, y: 0.3, z: 0 }],
      },
    ],
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    A: { x: 0.2, y: 1, z: 0 },
    B: { x: 1.8, y: 1, z: 0 },
    layerCount: 1,
    minDistBetweenEnteringPoints: 0.1,
    traceThickness: 0.1,
    viaDiameter: 0.2,
    obstacleMargin: 0.03,
    nearbySegmentClearance: 0.05,
  })
}

function makeUnkeyed(solver: SingleHighDensityRouteSolver): void {
  const initialNodes = solver.candidates.getTopN(Number.POSITIVE_INFINITY)
  solver.candidates = new SingleRouteCandidatePriorityQueue(initialNodes)
}

function observedState(solver: SingleHighDensityRouteSolver): unknown {
  return {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    explored: [...solver.exploredNodes],
    debug: solver.debug_exploredNodesOrdered,
    obstacleDebug: [...solver.debug_nodesTooCloseToObstacle],
    pathDebug: [...solver.debug_nodePathToParentIntersectsObstacle],
    solvedPath: solver.solvedPath,
  }
}

function expectSameSteps(
  indexed: SingleHighDensityRouteSolver,
  reference: SingleHighDensityRouteSolver,
): void {
  for (let step = 0; step < 1000; step++) {
    indexed.step()
    reference.step()
    expect(observedState(indexed)).toEqual(observedState(reference))
    if (indexed.solved || indexed.failed) {
      expect(indexed.solved).toBe(true)
      return
    }
  }
  throw new Error("compatibility fixture did not finish")
}

test("indexed HD frontier preserves public Set mutations and overridden dispatch", (): void => {
  const native = createSolver()
  const indexedQueue = native.candidates as SingleHighDensityRouteCandidateQueue
  expect(indexedQueue).toBeInstanceOf(SingleHighDensityRouteCandidateQueue)
  native.solve()
  expect(native.solved).toBe(true)
  expect(native.failed).toBe(false)
  expect(indexedQueue.diagnostics.dominated + indexedQueue.diagnostics.replaced)
    .toBeGreaterThan(0)

  const publicQueue = createSolver()
  const publicReference = createSolver()
  makeUnkeyed(publicReference)
  publicQueue.candidates.peek()
  expectSameSteps(publicQueue, publicReference)

  const setMutated = createSolver()
  const setReference = createSolver()
  makeUnkeyed(setReference)
  setMutated.candidates.getTopN(1)
  const blocked = setMutated.getNodeKey({
    x: 0.4,
    y: 1,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  })
  Set.prototype.add.call(setMutated.exploredNodes, blocked)
  Set.prototype.add.call(setReference.exploredNodes, blocked)
  Set.prototype.add.call(setMutated.exploredNodes, -0)
  Set.prototype.add.call(setReference.exploredNodes, 0)
  Set.prototype.add.call(setMutated.exploredNodes, Number.NaN)
  Set.prototype.add.call(setReference.exploredNodes, Number.NaN)
  expectSameSteps(setMutated, setReference)
  Set.prototype.delete.call(setMutated.exploredNodes, blocked)
  Set.prototype.delete.call(setReference.exploredNodes, blocked)
  expect([...setMutated.exploredNodes]).toEqual([...setReference.exploredNodes])

  const overriddenSet = createSolver()
  const overriddenReference = createSolver()
  makeUnkeyed(overriddenReference)
  const nativeHas = Set.prototype.has
  const counts = [0, 0]
  for (const [index, solver] of [overriddenSet, overriddenReference].entries()) {
    solver.exploredNodes.has = function has(key: number): boolean {
      counts[index]++
      const result = nativeHas.call(this, key)
      return result
    }
  }
  expectSameSteps(overriddenSet, overriddenReference)
  expect(counts[0]).toBe(counts[1])

  const originalKey = SingleHighDensityRouteSolver.prototype.getNodeKey
  const keyCalls = new Map<SingleHighDensityRouteSolver, number>()
  const prototypeIndexed = createSolver()
  const prototypeReference = createSolver()
  makeUnkeyed(prototypeReference)
  try {
    SingleHighDensityRouteSolver.prototype.getNodeKey = function getKey(
      node: Node,
    ): number {
      const previousCalls = keyCalls.get(this) ?? 0
      keyCalls.set(this, previousCalls + 1)
      return originalKey.call(this, node)
    }
    expectSameSteps(prototypeIndexed, prototypeReference)
    expect(keyCalls.get(prototypeIndexed)).toBe(keyCalls.get(prototypeReference))
  } finally {
    SingleHighDensityRouteSolver.prototype.getNodeKey = originalKey
  }

  const gridChanged = createSolver()
  const gridReference = createSolver()
  makeUnkeyed(gridReference)
  gridChanged.gridMinXIndex++
  gridReference.gridMinXIndex++
  expectSameSteps(gridChanged, gridReference)

  const originalEnqueue = SingleRouteCandidatePriorityQueue.prototype.enqueue
  const genericIndexed = createSolver()
  const genericReference = createSolver()
  makeUnkeyed(genericReference)
  const enqueueCalls = new Map<SingleRouteCandidatePriorityQueue, number>()
  try {
    SingleRouteCandidatePriorityQueue.prototype.enqueue = function enqueue(
      node: Node,
    ): void {
      const previousCalls = enqueueCalls.get(this) ?? 0
      enqueueCalls.set(this, previousCalls + 1)
      originalEnqueue.call(this, node)
    }
    expectSameSteps(genericIndexed, genericReference)
    expect(enqueueCalls.get(genericIndexed.candidates)).toBe(
      enqueueCalls.get(genericReference.candidates),
    )
    expect(genericIndexed.candidates).toBeInstanceOf(
      SingleHighDensityRouteCandidateQueue,
    )
  } finally {
    SingleRouteCandidatePriorityQueue.prototype.enqueue = originalEnqueue
  }

  const originalDown = SingleRouteCandidatePriorityQueue.prototype.heapifyDown
  const downCalls = new Map<SingleRouteCandidatePriorityQueue, number>()
  try {
    SingleRouteCandidatePriorityQueue.prototype.heapifyDown = function down(): void {
      const previousCalls = downCalls.get(this) ?? 0
      downCalls.set(this, previousCalls + 1)
      originalDown.call(this)
    }
    const downIndexed = createSolver()
    const downReference = createSolver()
    makeUnkeyed(downReference)
    expect(downIndexed.candidates).not.toBeInstanceOf(
      SingleHighDensityRouteCandidateQueue,
    )
    expectSameSteps(downIndexed, downReference)
    expect(downCalls.get(downIndexed.candidates)).toBe(
      downCalls.get(downReference.candidates),
    )
  } finally {
    SingleRouteCandidatePriorityQueue.prototype.heapifyDown = originalDown
  }
})
