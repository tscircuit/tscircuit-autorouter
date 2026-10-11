import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

type SolverParams = ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]

test("JSON cache keys distinguish scalar values and reuse equivalent cached routes", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "json-cache-key",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "signal:α", x: -1, y: -0.5, z: 0 },
      { connectionName: "signal:α", x: 1, y: -0.5, z: 0 },
      { connectionName: "signal:β", x: -1, y: 0.5, z: 1 },
      { connectionName: "signal:β", x: 1, y: 0.5, z: 1 },
    ],
  }
  const key = (params: Partial<SolverParams> = {}): string => {
    const solver = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: node,
      ...params,
      cacheProvider: null,
    })
    return solver.computeCacheKeyAndTransform().cacheKey
  }
  const values = [0, 1, NaN, Infinity, -Infinity]
  const numericKeys = values.map((value): string =>
    key({ hyperParameters: { VIA_PENALTY_FACTOR_2: value } }),
  )
  expect(new Set(numericKeys).size).toBe(values.length)
  expect(key({ hyperParameters: { VIA_PENALTY_FACTOR_2: -0 } })).toBe(
    numericKeys[0],
  )
  expect(key({ hyperParameters: { VIA_PENALTY_FACTOR_2: undefined } })).toBe(
    key(),
  )
  const booleanKeys = [undefined, false, true].map((value): string =>
    key({ hyperParameters: { FLIP_TRACE_ALIGNMENT_DIRECTION: value } }),
  )
  expect(new Set(booleanKeys).size).toBe(3)
  for (const value of values) {
    expect(
      key({ hyperParameters: { SHUFFLE_SEED: 0, VIA_PENALTY_FACTOR_2: value } }),
    ).toBe(
      key({ hyperParameters: { VIA_PENALTY_FACTOR_2: value, SHUFFLE_SEED: 0 } }),
    )
  }
  const optionalIds = [undefined, "u:", "n:NaN", "s:u:", "", "\ud800", "�"]
  const optionalKeys = optionalIds.map((portPointId): string =>
    key({
      nodeWithPortPoints: {
        ...node,
        portPoints: node.portPoints.map((point) => ({ ...point, portPointId })),
      },
    }),
  )
  expect(new Set(optionalKeys).size).toBe(optionalIds.length)
  expect(key({ nodeWithPortPoints: { ...node, availableZ: undefined } })).not.toBe(
    key({ nodeWithPortPoints: { ...node, availableZ: [] } }),
  )
  expect(key({ connMap: new ConnectivityMap({}) })).not.toBe(key())

  // Portfolio selector flags extend the named hyperparameter interface.
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: node,
    cacheProvider: null,
  })
  for (const definition of portfolio.getHyperParameterDefs()) {
    for (const parameters of definition.possibleValues) {
      for (const value of Object.values(parameters)) {
        expect(["number", "boolean"]).toContain(typeof value)
      }
      const hyperParameters = { SHUFFLE_SEED: 0, ...parameters }
      expect(key({ hyperParameters })).toBe(
        key({
          hyperParameters: Object.fromEntries(
            Object.entries(hyperParameters).reverse(),
          ),
        }),
      )
    }
  }

  const cache = new InMemoryCache()
  const producer = new CachedIntraNodeRouteSolver({
    nodeWithPortPoints: node,
    hyperParameters: { VIA_PENALTY_FACTOR_2: 1, SHUFFLE_SEED: 0 },
    cacheProvider: cache,
  })
  producer.solve()
  expect(producer.solved).toBe(true)
  expect(producer.cacheHit).toBe(false)
  const consumer = new CachedIntraNodeRouteSolver({
    nodeWithPortPoints: structuredClone(node),
    hyperParameters: { SHUFFLE_SEED: 0, VIA_PENALTY_FACTOR_2: 1 },
    cacheProvider: cache,
  })
  expect(consumer.attemptToUseCacheSync()).toBe(true)
  expect(consumer.solvedRoutes).toEqual(producer.solvedRoutes)
  expect(consumer.solvedRoutes).not.toBe(producer.solvedRoutes)
  const otherWidth = new CachedIntraNodeRouteSolver({
    nodeWithPortPoints: node,
    hyperParameters: { SHUFFLE_SEED: 0, VIA_PENALTY_FACTOR_2: 1 },
    traceWidth: 0.1,
    cacheProvider: cache,
  })
  expect(otherWidth.attemptToUseCacheSync()).toBe(false)
})
