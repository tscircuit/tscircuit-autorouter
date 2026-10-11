import { expect, test } from "bun:test"
import { installParallelHighDensityRouteGridKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/installParallelHighDensityGridKernel"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as GridSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type ClosestDiagnostic = {
  closestFuturePointCacheCoordinates: Float64Array
  closestFuturePointCacheIndices: Int32Array
  cachedFutureConnectionPoints?: GridSolver["futureConnectionPoints"]
  cachedFutureConnectionPointCount: number
}

function assertClosestState(native: GridSolver, packed: GridSolver): void {
  const a = native as unknown as ClosestDiagnostic
  const b = packed as unknown as ClosestDiagnostic
  expect(b.closestFuturePointCacheIndices).toEqual(a.closestFuturePointCacheIndices)
  for (let index = 0; index < a.closestFuturePointCacheCoordinates.length; index++) {
    expect(Object.is(b.closestFuturePointCacheCoordinates[index], a.closestFuturePointCacheCoordinates[index])).toBeTrue()
  }
  expect(b.cachedFutureConnectionPointCount).toBe(a.cachedFutureConnectionPointCount)
  expect(b.cachedFutureConnectionPoints?.length).toBe(a.cachedFutureConnectionPoints?.length)
}

function compareCosts(native: GridSolver, packed: GridSolver, query: Node): void {
  const a = structuredClone(query), b = structuredClone(query)
  native.setNodeCosts(a)
  packed.setNodeCosts(b)
  expect(Object.is(b.g, a.g)).toBeTrue()
  expect(Object.is(b.h, a.h)).toBeTrue()
  expect(Object.is(b.f, a.f)).toBeTrue()
  assertClosestState(native, packed)
}

test("HD cost memo preserves native selectors, public mutations, collisions and callbacks", (): void => {
  const opts: ConstructorParameters<typeof GridSolver>[0] = {
    connectionName: "signal", obstacleRoutes: [], minDistBetweenEnteringPoints: 0.1,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    A: { x: -8, y: -7, z: 0 }, B: { x: 8, y: 7, z: 1 },
    futureConnections: [{ connectionName: "future", points: [
      { x: 0.1, y: 0.2, z: 0 }, { x: 1, y: 0.2, z: 0 },
      { x: -0.5, y: 0.9, z: 1 },
    ] }], layerCount: 2, captureSearchDebug: true,
  }
  const native = new GridSolver(structuredClone(opts))
  const packed = new GridSolver(structuredClone(opts))
  installParallelHighDensityRouteGridKernel(packed)
  let randomState = 0xa4907153
  const random = (): number => {
    randomState ^= randomState << 13
    randomState ^= randomState >>> 17
    randomState ^= randomState << 5
    return (randomState >>> 0) / 0x100000000
  }
  const parent: Node = { x: -0.1, y: 0.2, z: 0, g: 0.3, h: 0, f: 0, parent: null }
  const query: Node = { x: 0, y: 0.2, z: 0, g: 0, h: 0, f: 0, parent }
  compareCosts(native, packed, query)
  for (const solver of [native, packed]) solver.futureConnectionPoints[0]!.x = 20
  compareCosts(native, packed, query)
  // The original selector remains sticky until this colliding query evicts it.
  const collision = { ...query, x: query.x + native.cellStep * 256 }
  expect(native.getNodeKey(collision) - native.getNodeKey(query)).toBe(256)
  compareCosts(native, packed, collision)
  compareCosts(native, packed, query)
  for (const solver of [native, packed]) delete solver.futureConnectionPoints[0]
  compareCosts(native, packed, query)
  expect(() => native.setNodeCosts(structuredClone(collision))).toThrow()
  expect(() => packed.setNodeCosts(structuredClone(collision))).toThrow()
  for (const solver of [native, packed]) solver.futureConnectionPoints[0] = { x: 0.1, y: 0.2, z: 0 }
  compareCosts(native, packed, query)
  for (const solver of [native, packed]) solver.futureConnectionPoints[0]!.x = 0.1
  compareCosts(native, packed, query)
  const poisonOpts = {
    ...structuredClone(opts), B: { x: 20, y: 0, z: 0 },
    futureConnections: [{ connectionName: "future", points: [
      { x: 1.1, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 },
    ] }],
  }
  const poisonNative = new GridSolver(structuredClone(poisonOpts))
  const poisonPacked = new GridSolver(structuredClone(poisonOpts))
  installParallelHighDensityRouteGridKernel(poisonPacked)
  const poisonQuery = { ...query, x: 1, y: 0 }
  const poisonCollision = { ...poisonQuery, x: 1 + poisonNative.cellStep * 512 }
  compareCosts(poisonNative, poisonPacked, poisonQuery)
  for (const solver of [poisonNative, poisonPacked]) delete solver.futureConnectionPoints[1]
  expect(() => poisonNative.setNodeCosts(structuredClone(poisonCollision))).toThrow()
  expect(() => poisonPacked.setNodeCosts(structuredClone(poisonCollision))).toThrow()
  for (const solver of [poisonNative, poisonPacked]) solver.futureConnectionPoints[1] = { x: 1000, y: 0, z: 0 }
  compareCosts(poisonNative, poisonPacked, poisonCollision)
  compareCosts(poisonNative, poisonPacked, poisonQuery)
  compareCosts(native, packed, collision)
  compareCosts(native, packed, query)
  const special = [-0, 0, NaN, Infinity, -Infinity, Number.MIN_VALUE]
  for (let iteration = 0; iteration < 320; iteration++) {
    const value = iteration < special.length ? special[iteration]! : random() * 4 - 2
    for (const solver of [native, packed]) {
      switch (iteration % 16) {
        case 0: solver.B.x = value; break
        case 1: solver.B.y = value; break
        case 2: solver.B.z = iteration % 3; break
        case 3: solver.straightLineDistance = value; break
        case 4: solver.VIA_PENALTY_FACTOR = value; break
        case 5: solver.viaDiameter = value; break
        case 6: solver.FUTURE_CONNECTION_PROXIMITY_VD = value; break
        case 7: solver.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR = value; break
        case 8: solver.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR = value; break
        case 9: solver.futureConnectionPoints[0]!.x = value; break
        case 10: solver.futureConnectionPoints[0]!.y = value; break
        case 11: solver.futureConnectionPoints[0]!.z = iteration % 3; break
        case 12: solver.futureConnectionPoints.reverse(); break
        case 13: solver.futureConnectionPoints[0] = { x: value, y: 0.2, z: 0 }; break
        case 14:
          solver.futureConnectionPoints = solver.futureConnectionPoints.map((point) => ({ ...point }))
          break
        case 15:
          solver.FLIP_TRACE_ALIGNMENT_DIRECTION = !solver.FLIP_TRACE_ALIGNMENT_DIRECTION
          solver.MISALIGNED_DIST_PENALTY_FACTOR = value
          solver.GREEDY_MULTIPLER = value
          break
      }
    }
    parent.g = value
    parent.z = iteration % 2
    compareCosts(native, packed, query)
    compareCosts(native, packed, { ...query, z: 1 })
    compareCosts(native, packed, { ...query, x: query.x + native.cellStep / 1000 })
    compareCosts(native, packed, { ...query, x: query.x + native.cellStep * 512 })
    compareCosts(native, packed, query)
  }
  for (const solver of [native, packed]) {
    solver.futureConnectionPoints = []
    solver.B = { x: 8, y: 7, z: 1 }
    solver.straightLineDistance = 10
    solver.cellStep = 0.1
    solver.VIA_PENALTY_FACTOR = 0.3
  }
  compareCosts(native, packed, query)
  compareCosts(native, packed, { ...query, x: Infinity })
  compareCosts(native, packed, { ...query, x: NaN })
  compareCosts(native, packed, { ...query, x: -0, y: -0 })
  // Explicit custom callbacks preserve the public native method path.
  const calls = [0, 0]
  for (const [index, solver] of [native, packed].entries()) {
    const closest = solver.getClosestFutureConnectionPoint.bind(solver)
    solver.getClosestFutureConnectionPoint = (node: Node): ReturnType<typeof closest> => {
      calls[index]++
      const selected = closest(node)
      solver.B.x += 0.1
      return selected
    }
  }
  compareCosts(native, packed, query)
  compareCosts(native, packed, query)
  expect(calls).toEqual([2, 2])
  for (const solver of [native, packed]) {
    solver.getClosestFutureConnectionPoint = GridSolver.prototype.getClosestFutureConnectionPoint
  }
  const getterCalls = [0, 0]
  for (const [index, solver] of [native, packed].entries()) {
    Object.defineProperty(solver, "viaPenaltyDistance", {
      configurable: true,
      get: (): number => {
        getterCalls[index]++
        const alternating = getterCalls[index] % 2 === 0 ? 0.1 : 0.2
        return solver.cellStep + solver.straightLineDistance * alternating
      },
    })
  }
  compareCosts(native, packed, { ...query, z: 1 })
  expect(getterCalls[1]).toBe(getterCalls[0])
  const stepNative = new GridSolver(structuredClone(opts))
  const stepPacked = new GridSolver(structuredClone(opts))
  installParallelHighDensityRouteGridKernel(stepPacked)
  stepNative.MAX_ITERATIONS = stepPacked.MAX_ITERATIONS = 90
  while (!stepNative.solved && !stepNative.failed) {
    if (stepNative.iterations % 5 === 0) {
      for (const solver of [stepNative, stepPacked]) {
        solver.futureConnectionPoints[0]!.x += 0.05
        solver.B.y -= 0.01
        solver.VIA_PENALTY_FACTOR += 0.01
      }
    }
    stepNative.step()
    stepPacked.step()
    expect(stepPacked.candidates.getTopN(12)).toEqual(stepNative.candidates.getTopN(12))
    expect([...stepPacked.exploredNodes]).toEqual([...stepNative.exploredNodes])
    expect(stepPacked.debug_exploredNodesOrdered).toEqual(stepNative.debug_exploredNodesOrdered)
    expect(stepPacked.solvedPath).toEqual(stepNative.solvedPath)
    expect(stepPacked.iterations).toBe(stepNative.iterations)
    expect(stepPacked.MAX_ITERATIONS).toBe(stepNative.MAX_ITERATIONS)
    expect(stepPacked.solved).toBe(stepNative.solved)
    expect(stepPacked.failed).toBe(stepNative.failed)
    assertClosestState(stepNative, stepPacked)
  }
  // A failed batch validation must release its direct-call configuration guard.
  const oldB = stepPacked.B
  Object.defineProperty(stepPacked, "B", {
    configurable: true,
    get: (): never => { throw new Error("diagnostic target read") },
  })
  expect(() => stepPacked.getNeighbors(query)).toThrow("diagnostic target read")
  Object.defineProperty(stepPacked, "B", { configurable: true, writable: true, value: oldB })
  oldB.x += 0.3
  stepNative.B.x += 0.3
  compareCosts(stepNative, stepPacked, query)
})
