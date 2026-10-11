import { expect, test } from "bun:test"
import { TraceSimplificationSolver, UselessViaRemovalSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PhysicalTraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PhysicalTraceSimplificationSolver"
import { useOptimizedViaRemovalSpatialIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/useOptimizedViaRemovalSpatialIndex"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("physical simplification uses the exact local via index before each native child starts", (): void => {
  const routes: HighDensityRoute[] = [
    { connectionName: "detour", rootConnectionName: "detour-net", traceThickness: .15, viaDiameter: .4,
      route: [{ x: -3, y: 3, z: 0, pcb_port_id: "start" }, { x: -2, y: 3, z: 0 },
        { x: -2, y: 3, z: 1 }, { x: -2, y: -2, z: 1 }, { x: -1, y: -3, z: 1 },
        { x: -1, y: -3, z: 0 }, { x: 1, y: -5, z: 0, pcb_port_id: "end" }],
      vias: [{ x: -2, y: 3 }, { x: -1, y: -3 }] },
    { connectionName: "transition", traceThickness: .2, viaDiameter: .6,
      route: [{ x: 0, y: 4, z: 1 }, { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 0 }, { x: -3, y: 0, z: 0 }], vias: [{ x: 0, y: 0 }] },
    { connectionName: "removable", traceThickness: .15, viaDiameter: .4,
      route: [{ x: 5, y: 2, z: 0 }, { x: 6, y: 2, z: 0 }, { x: 6, y: 2, z: 1 },
        { x: 8, y: 2, z: 1 }, { x: 8, y: 2, z: 0 }, { x: 9, y: 2, z: 0 }],
      vias: [{ x: 6, y: 2 }, { x: 8, y: 2 }] },
  ]
  const immutable: HighDensityRoute[] = [
    { connectionName: "fixed", traceThickness: .3, viaDiameter: 1,
      route: [{ x: 2, y: -4, z: 0 }, { x: 2, y: 4, z: 0 }], vias: [{ x: 2, y: 0 }] },
    { connectionName: "fixed", traceThickness: .15, viaDiameter: .3,
      route: [{ x: 10, y: -4, z: 1 }, { x: 10, y: 4, z: 1 }], vias: [] },
  ]
  const originalInput = structuredClone({ routes, immutable })
  for (const enableCrossingViaReduction of [false, true]) {
    for (const preserveRouteEndpoints of [false, true]) {
      const config = { hdRoutes: routes, otherHdRoutes: immutable, obstacles: [],
        connMap: new ConnectivityMap({ first: ["detour", "detour-net", "start", "end"],
          second: ["transition"], third: ["removable"], fixed: ["fixed"] }),
        colorMap: {}, defaultViaDiameter: .4, layerCount: 2,
        outline: [{ x: -8, y: -8 }, { x: 12, y: -8 }, { x: 12, y: 8 }, { x: -8, y: 8 }],
        enableCrossingViaReduction, preserveRouteEndpoints, enableVertexShortcuts: true,
        useTraceWidthAwareClearance: true }
      const reference = new TraceSimplificationSolver(config)
      const optimized = new PhysicalTraceSimplificationSolver(config)
      const seenChildren = new Set<UselessViaRemovalSolver>()
      while (!reference.solved && !reference.failed) {
        reference.step()
        optimized.step()
        expect(optimized.iterations).toBe(reference.iterations)
        expect(optimized.solved).toBe(reference.solved)
        expect(optimized.failed).toBe(reference.failed)
        expect(optimized.stats).toEqual(reference.stats)
        expect(optimized.currentPhase).toBe(reference.currentPhase)
        expect(optimized.simplificationPipelineLoops).toBe(reference.simplificationPipelineLoops)
        expect(optimized.hdRoutes).toEqual(reference.hdRoutes)
        const actual = optimized.activeSubSolver
        const expected = reference.activeSubSolver
        expect(actual?.iterations).toBe(expected?.iterations)
        expect(actual?.stats).toEqual(expected?.stats)
        if (actual instanceof UselessViaRemovalSolver && expected instanceof UselessViaRemovalSolver) {
          expect(actual.hdRouteSHI).toBeInstanceOf(HighDensityRouteSpatialIndex)
          expect(expected.hdRouteSHI).not.toBeInstanceOf(HighDensityRouteSpatialIndex)
          if (!seenChildren.has(actual)) {
            expect(actual.iterations).toBe(0)
            seenChildren.add(actual)
          }
          expect(actual.optimizedHdRoutes).toEqual(expected.optimizedHdRoutes)
          expect(actual.unprocessedRoutes).toEqual(expected.unprocessedRoutes)
          expect(actual.activeSubSolver?.iterations).toBe(expected.activeSubSolver?.iterations)
          expect(actual.activeSubSolver?.stats).toEqual(expected.activeSubSolver?.stats)
          expect(actual.activeSubSolver?.routeSections).toEqual(expected.activeSubSolver?.routeSections)
          for (const z of [0, 1]) {
            const start = { x: -4, y: z, z }
            const end = { x: 11, y: z, z }
            expect(actual.hdRouteSHI!.getConflictingRoutesForSegment(start, end, .2)).toEqual(
              expected.hdRouteSHI!.getConflictingRoutesForSegment(start, end, .2))
            expect(actual.hdRouteSHI!.getConflictingRoutesNearPoint({ x: 2, y: 0, z }, .2)).toEqual(
              expected.hdRouteSHI!.getConflictingRoutesNearPoint({ x: 2, y: 0, z }, .2))
          }
        }
      }
      expect(reference.solved).toBe(true)
      expect(optimized.simplifiedHdRoutes).toEqual(reference.simplifiedHdRoutes)
      expect(optimized.simplifiedHdRoutes[2]!.vias).toHaveLength(0)
      expect(seenChildren.size).toBe(2)
      const started = [...seenChildren][0]!
      expect(() => useOptimizedViaRemovalSpatialIndex(started, immutable)).toThrow("before the child starts")
    }
  }
  expect({ routes, immutable }).toEqual(originalInput)
})
