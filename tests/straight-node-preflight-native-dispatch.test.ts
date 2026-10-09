import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { createStraightRoutePreflightContext } from "lib/solvers/HyperHighDensitySolver/getCertifiedStraightIntraNodeRoutes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const makeSolver = (): PortfolioSingleIntraNodeSolver => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 4, height: 4,
    availableZ: [0, 1],
    portPoints: [{ x: -2, y: -1, z: 0, connectionName: "a" }, { x: 2, y: 1, z: 0, connectionName: "a" }],
  }
  return new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap({}),
    layerCount: 2,
    boardGeometry: { bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 } },
    straightRoutePreflightContext: createStraightRoutePreflightContext({ minX: -2, maxX: 2, minY: -2, maxY: 2 }),
  })
}
const acceptsNativeDispatch = (solver: PortfolioSingleIntraNodeSolver): boolean => {
  const internal = solver as unknown as { hasNativeStraightPreflightDispatch(): boolean }
  const result = internal.hasNativeStraightPreflightDispatch()
  return result
}

test("only native explicit original-bounds attempts skip portfolio setup without reading callback getters", () => {
  const native = makeSolver()
  native.step()
  expect(native.solved).toBe(true)
  expect(native.supervisedSolvers).toBeUndefined()
  expect(native.stats.straightPreflightAccepted).toBe(true)
  expect(native.MAX_ITERATIONS).toBe(20_000_000)
  const standalone = makeSolver()
  standalone.constructorParams.straightRoutePreflightContext = undefined
  standalone.step()
  expect(standalone.supervisedSolvers).toBeDefined()
  expect(standalone.stats.straightPreflightAccepted).toBeUndefined()
  const custom = makeSolver()
  let solveCalls = 0
  const nativeOnSolve = custom.onSolve
  custom.onSolve = (...args): void => { solveCalls++; nativeOnSolve.apply(custom, args) }
  custom.solve()
  expect(custom.stats.straightPreflightAccepted).toBeUndefined()
  expect(custom.supervisedSolvers).toBeDefined()
  expect(solveCalls).toBe(1)
  let getterCalls = 0
  const map = makeSolver().connMap!
  const descriptors: Array<[object, string]> = [
    [PortfolioSingleIntraNodeSolver.prototype, "computeF"],
    [ConnectivityMap.prototype, "areIdsConnected"],
    [InMemoryCache.prototype, "getCachedSolutionSync"],
  ]
  for (const [prototype, name] of descriptors) {
    const saved = Object.getOwnPropertyDescriptor(prototype, name)
    const solver = makeSolver()
    const method = (prototype as Record<string, unknown>)[name]
    Object.defineProperty(prototype, name, { configurable: true, get: () => { getterCalls++; return method } })
    try {
      expect(acceptsNativeDispatch(solver)).toBe(false)
      expect(getterCalls).toBe(0)
    } finally {
      if (saved) Object.defineProperty(prototype, name, saved)
      else Reflect.deleteProperty(prototype, name)
    }
  }
  const ownMethod = makeSolver()
  Object.defineProperty(ownMethod, "computeF", { configurable: true, get: () => { getterCalls++; return native.computeF } })
  expect(acceptsNativeDispatch(ownMethod)).toBe(false)
  expect(getterCalls).toBe(0)
  const cache = globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE")!
  const cacheSolver = makeSolver()
  Object.defineProperty(globalThis, "TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE", { configurable: true, get: () => { getterCalls++; return cache } })
  try {
    expect(acceptsNativeDispatch(cacheSolver)).toBe(false)
    expect(getterCalls).toBe(0)
  } finally {
    Object.defineProperty(globalThis, "TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE", descriptor)
  }
  const customMap = makeSolver()
  customMap.connMap = map
  map.areIdsConnected = (): boolean => true
  expect(acceptsNativeDispatch(customMap)).toBe(false)
  const nullCacheSolver = makeSolver()
  Object.defineProperty(globalThis, "TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE", { ...descriptor, value: null })
  try {
    expect(acceptsNativeDispatch(nullCacheSolver)).toBe(false)
  } finally {
    Object.defineProperty(globalThis, "TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE", descriptor)
  }
})
