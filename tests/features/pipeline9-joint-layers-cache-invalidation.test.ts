import { expect, test } from "bun:test"
import { Pipeline9JointLayerAssignmentSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointLayerAssignmentSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createJointLayerCacheFixture } from "tests/utils/joint-layer-cache"

test("joint-layer cache entries respect route versions, static rejections and bounded eviction", (): void => {
  const fixture = createJointLayerCacheFixture(false)
  const solver = new Pipeline9JointLayerAssignmentSolver({ routes: fixture.routes,
    fixedRoutes: [], layerCount: 2, connMap: fixture.connMap,
    obstacles: fixture.srj.obstacles, clearance: 0.1,
    evaluate: (routes) => ({ valid: true,
      manufacturedSites: routes.reduce((sum, route) => sum + route.vias.length, 0) }),
  })
  type Entry = { index: number; sections: unknown[]; layers: number[] }
  const internals = solver as unknown as {
    entries: Entry[]; variantCache: Map<string, unknown>; pairConflictCache: Map<string, unknown>
    hasConflict: (left: HighDensityRoute, right: HighDensityRoute) => boolean
    makeVariants: (entry: Entry, fixed: HighDensityRoute[], allowance: number) => Array<{ route: HighDensityRoute; sites: number }>
  }
  const entry = internals.entries[0]
  const first = internals.makeVariants(entry, [], 1000)
  const firstMisses = solver.stats.variantCacheMisses
  const second = internals.makeVariants(entry, [], 1000)
  expect(second).toEqual(first)
  expect(solver.stats.variantCacheMisses).toBe(firstMisses)
  expect(solver.stats.variantCacheHits).toBeGreaterThan(0)
  expect(solver.stats.copperRejected).toBeGreaterThan(0)
  solver.bestRoutes = solver.bestRoutes.slice()
  solver.bestRoutes[entry.index] = { ...solver.bestRoutes[entry.index], traceThickness: 5 }
  internals.makeVariants(entry, [], 1000)
  expect(solver.stats.variantCacheMisses).toBeGreaterThan(firstMisses)

  const left: HighDensityRoute = { connectionName: "cache_left", traceThickness: 0.15,
    viaDiameter: 0.4, vias: [], route: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] }
  const outside: HighDensityRoute = { ...left, connectionName: "cache_outside",
    route: [{ x: 0, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }] }
  expect(internals.hasConflict(left, outside)).toBe(false)
  expect(internals.hasConflict(left, outside)).toBe(false)
  expect(solver.stats.pairCacheHits).toBeGreaterThan(0)
  const replacement: HighDensityRoute = { ...outside, route: structuredClone(left.route) }
  expect(internals.hasConflict(left, replacement)).toBe(true)
  const wider: HighDensityRoute = { ...outside, traceThickness: 5 }
  expect(internals.hasConflict(left, wider)).toBe(true)
  const sameNet: HighDensityRoute = { ...replacement, connectionName: left.connectionName }
  expect(internals.hasConflict(left, sameNet)).toBe(false)
  for (let index = 0; index < 32768; index++)
    internals.pairConflictCache.set(`eviction:${index}`, false)
  internals.pairConflictCache.delete("eviction:0")
  while (internals.pairConflictCache.size > 32768)
    internals.pairConflictCache.delete(internals.pairConflictCache.keys().next().value!)
  internals.hasConflict(replacement, wider)
  expect(internals.pairConflictCache.size).toBeLessThanOrEqual(32768)
  expect(internals.hasConflict(left, outside)).toBe(false)
  expect(internals.hasConflict(left, replacement)).toBe(true)
  for (let index = 0; index < 1024; index++)
    internals.variantCache.set(`eviction:${index}`, {})
  while (internals.variantCache.size > 1024)
    internals.variantCache.delete(internals.variantCache.keys().next().value!)
  solver.bestRoutes[entry.index] = fixture.routes[entry.index]
  expect(internals.makeVariants(entry, [], 1000)).toEqual(first)
  expect(internals.variantCache.size).toBeLessThanOrEqual(1024)
})
