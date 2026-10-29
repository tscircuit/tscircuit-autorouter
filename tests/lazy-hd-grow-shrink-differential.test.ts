import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import { makeLazyHdSyntheticNode } from "./fixtures/lazyHdSynthetic"

test("growth retries preserve scale, budgets and accepted routes with independently owned attempt nodes", () => {
  for (let seed = 0; seed < 12; seed++) {
    const node = makeLazyHdSyntheticNode(seed)
    node.width *= 0.3
    node.height *= 0.3
    const common = { nodeWithPortPoints: node, effort: 1, viaDiameter: 0.3, traceWidth: 0.1, layerCount: 2, maxGrowthAttempts: 2, priorityDagSearch: true, gridSearchSegmentWork: 500, gridSearchWorkScale: 1, fallbackToInvalidGeometryOnFailure: false, maxInnerIterationsPerGrowthAttempt: 100 }
    const native = new GrowShrinkHighDensityIntraNodeSolver({ ...common, cacheProvider: new InMemoryCache(), priorityDiagnostics: {} })
    const lazy = new GrowShrinkHighDensityIntraNodeSolver({ ...common, experimentLazyHdCandidates: true, cacheProvider: new InMemoryCache(), priorityDiagnostics: {} })
    for (let step = 0; step < 1000 && !native.solved && !native.failed; step++) {
      native.step(); lazy.step()
      expect(lazy.iterations).toBe(native.iterations)
      expect(lazy.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
      expect(lazy.scaleFactor).toBe(native.scaleFactor)
      expect(lazy.growthAttempts).toBe(native.growthAttempts)
      expect(lazy.solved).toBe(native.solved)
      expect(lazy.failed).toBe(native.failed)
      expect(lazy.error).toBe(native.error)
      expect(lazy.solvedRoutes).toEqual(native.solvedRoutes)
    }
  }
})
