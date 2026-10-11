import { expect, test } from "bun:test"
import { deepStrictEqual } from "node:assert"
import { MultiSimplifiedPathSolver, SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { filterNativePathCertificatePrimitives } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/filterNativePathCertificatePrimitives"
import { captureParallelPathPrototypeContract, createParallelPathLookaheadEligibility } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility"
import { createNativeParallelPathLookaheadRun, ParallelPathLookaheadCoordinator } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadCoordinator"
import { Pipeline9LocalWorkerPool } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { HighDensityRoute } from "../../lib/types/high-density-types"

const contract = captureParallelPathPrototypeContract(MultiSimplifiedPathSolver.prototype)

test("private filter-only certificates keep Native filter order, source aliases, signed zeros and custom constructor fallback", async () => {
  await initializeReferenceDrcRuntime()
  let seed = 0x7321431
  const random = (): number => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return (seed >>> 0) / 0x1_0000_0000
  }
  for (let fixture = 0; fixture < 512; fixture++) {
    const metadata = { fixture }
    const makeRoute = (index: number): HighDensityRoute => ({
      connectionName: `route-${index % 4}`,
      rootConnectionName: index % 3 === 0 ? "shared-net" : undefined,
      traceThickness: 0.15, viaDiameter: fixture % 11 === 0 ? -0 : 0.3,
      route: Array.from({ length: index === 0 && fixture % 8 < 2 ? fixture % 8 : 5 }, (_, point) => ({
        x: point === 0 && fixture % 9 === 0 ? -0 : Math.floor(random() * 16) / 4 - 2,
        y: point === 1 && fixture % 7 === 0 ? -0 : Math.floor(random() * 16) / 4 - 2,
        z: Math.floor(random() * 2), metadata,
      })),
      vias: [{ x: fixture % 7 === 0 ? -0 : random() * 4 - 2, y: random() * 4 - 2, metadata } as HighDensityRoute["vias"][number] & { metadata: typeof metadata }],
    })
    const inputRoute = makeRoute(0)
    const otherHdRoutes = Array.from({ length: 7 }, (_, index) => makeRoute(index + 1))
    if (fixture % 2 === 0) otherHdRoutes.push(otherHdRoutes[2]!)
    if (fixture % 3 === 0) otherHdRoutes[1]!.route[1] = otherHdRoutes[0]!.route[0]!
    const params = { inputRoute, otherHdRoutes, obstacles: [], colorMap: {}, useTraceWidthAwareClearance: false,
      connMap: new ConnectivityMap({ "shared-net": ["route-0", "route-3"] }) }
    const native = new SingleSimplifiedPathSolver5(params)
    const actual = filterNativePathCertificatePrimitives(params)
    deepStrictEqual(actual, { filteredObstaclePathSegments: native.filteredObstaclePathSegments, filteredVias: native.filteredVias })
    expect(actual.filteredObstaclePathSegments.length).toBe(native.filteredObstaclePathSegments.length)
    for (let index = 0; index < actual.filteredObstaclePathSegments.length; index++) {
      const pair = actual.filteredObstaclePathSegments[index]!
      expect(pair[0]).toBe(native.filteredObstaclePathSegments[index]![0])
      expect(pair[1]).toBe(native.filteredObstaclePathSegments[index]![1])
      expect(Object.is(pair[0].x, native.filteredObstaclePathSegments[index]![0].x)).toBe(true)
    }
    for (let index = 0; index < actual.filteredVias.length; index++) {
      const via = actual.filteredVias[index]! as typeof otherHdRoutes[number]["vias"][number] & { diameter: number; metadata: unknown }
      const original = native.filteredVias[index]! as typeof via
      expect(via).not.toBe(original)
      expect(via.metadata).toBe(original.metadata)
      expect(Object.is(via.x, original.x)).toBe(true)
      expect(Object.is(via.diameter, original.diameter)).toBe(true)
    }
  }

  const makeOwner = (): MultiSimplifiedPathSolver => new MultiSimplifiedPathSolver({ obstacles: [],
    unsimplifiedHdRoutes: Array.from({ length: 12 }, (_, index) => ({ connectionName: `private-${index}`,
      traceThickness: 0.15, viaDiameter: 0.3, vias: [],
      route: [{ x: -1, y: index * 0.8, z: 0 }, { x: 0, y: index * 0.8 + 0.2, z: 0 }, { x: 1, y: index * 0.8, z: 0 }] })) })
  for (const genuine of [true, false]) {
    const native = makeOwner()
    native.solve()
    const actual = makeOwner()
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, contextTransport: "bun-shared" })
    try {
      const helper = createParallelPathLookaheadEligibility(actual, contract)!
      expect(helper()).toBe(true)
      const run = genuine ? createNativeParallelPathLookaheadRun(actual, helper, pool)! :
        ((job: Parameters<NonNullable<ReturnType<typeof createNativeParallelPathLookaheadRun>>>[0]) => pool.run(job))
      const coordinator = new ParallelPathLookaheadCoordinator({ original: actual, contextId: pool.createContextId(), workerCount: 4,
        run: run as NonNullable<ReturnType<typeof createNativeParallelPathLookaheadRun>>,
        nativeEligibility: helper, nativeWorkerPool: pool, isEligible: helper,
        captureScope: helper.captureScope, captureAwaitState: helper.captureAwaitState })
      expect(Reflect.ownKeys(coordinator).includes("certifier")).toBe(false)
      let shadowReads = 0
      Object.defineProperty(coordinator, "certifier", { get() { shadowReads++; throw new Error("exposed certifier") } })
      await coordinator.solve()
      expect(shadowReads).toBe(0)
      expect(actual.simplifiedHdRoutes).toEqual(native.simplifiedHdRoutes)
      expect(actual.iterations).toBe(native.iterations)
      expect(actual.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
      expect(actual.progress).toBe(native.progress)
      expect(actual.activeSubSolver).toBeNull()
      expect(pool.stats.maxActiveWorkers).toBe(4)
      expect(pool.stats.tasksCompleted).toBe(pool.stats.tasksStarted)
      if (genuine) {
        expect(coordinator.stats.nativeFilterOnlyViews).toBeGreaterThan(0)
        expect(coordinator.stats.nativeFilterConstructors).toBe(0)
      } else {
        expect(coordinator.stats.nativeFilterOnlyViews).toBe(0)
        expect(coordinator.stats.nativeFilterConstructors).toBeGreaterThan(0)
      }
    } finally { pool.dispose() }
  }
})
