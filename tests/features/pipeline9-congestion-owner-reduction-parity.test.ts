import { NegotiateTraceClearanceSolver, type NegotiatedClearanceInput } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import type { HighDensityRoute } from "high-density-repair03/lib"
import { Pipeline9DenseNegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9DenseNegotiateTraceClearanceSolver"

test("owner congestion reduction preserves exact searches with repeated owners, frozen drills and changing weights", (): void => {
  const bounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 }
  let totalSearches = 0
  let totalNodes = 0
  let displacedRoutes = 0
  for (let caseIndex = 0; caseIndex < 36; caseIndex++) {
    const routes: HighDensityRoute[] = []
    for (let index = 0; index < 8; index++) {
      const lane = (index - 3.5) * 0.16
      const horizontal = index % 2 === 0
      const offset = ((caseIndex * 17 + index * 11) % 13 - 6) * 0.025
      const start = horizontal ? { x: -1.8, y: lane, z: 0 } : { x: lane, y: -1.8, z: 0 }
      const center = horizontal ? { x: offset, y: lane + offset, z: 0 } : { x: lane + offset, y: offset, z: 0 }
      const end = horizontal ? { x: 1.8, y: lane, z: 0 } : { x: lane, y: 1.8, z: 0 }
      const hasVia = (caseIndex + index) % 3 === 0
      routes.push({
        connectionName: `owner${Math.floor(index / 2)}`,
        traceThickness: 0.08 + (index % 3) * 0.02,
        viaDiameter: 0.2 + (index % 2) * 0.05,
        vias: hasVia ? [{ x: center.x, y: center.y }] : [],
        route: hasVia ? [start, center, { ...center, z: 1 }, { ...end, z: 1 }] : [start, center, end],
      })
    }
    const input: NegotiatedClearanceInput = {
      srj: {
        bounds,
        layerCount: 2,
        minTraceWidth: 0.1,
        connections: [],
        obstacles: [],
        allowBlindAndBuriedVias: caseIndex % 2 === 0,
      },
      routes,
      bounds,
      dirtyRouteIndices: [0, 1, 2],
      isLocked: (routeIndex, pointIndex): boolean => caseIndex % 4 === 0 && routeIndex > 4 && pointIndex === 1,
      allowLayerChanges: true,
      traceClearance: 0.07 + (caseIndex % 3) * 0.02,
      viaClearance: 0.1,
      viaHoleDiameter: 0.1,
      pathGridSizeScale: 2,
      pathHeuristicWeight: caseIndex % 2 === 0 ? 1 : 3,
      maxPathSearchNodes: 2_500,
      maxPathSearchNodesPerCall: 500,
      maxPathSearchCalls: 12,
    }
    const original = structuredClone(routes)
    const baseline = new NegotiateTraceClearanceSolver(input)
    const reduced = new Pipeline9DenseNegotiateTraceClearanceSolver(input)
    while (!baseline.solved && !baseline.failed) {
      baseline.step()
      reduced.step()
      expect(reduced.stats).toEqual(baseline.stats)
      expect(reduced.solved).toBe(baseline.solved)
    }
    expect(reduced.failed).toBeFalse()
    expect(reduced.getOutput()).toEqual(baseline.getOutput())
    expect(reduced.iterations).toBe(baseline.iterations)
    expect(reduced.MAX_ITERATIONS).toBe(baseline.MAX_ITERATIONS)
    expect(routes).toEqual(original)
    totalSearches += reduced.getOutput().pathSearchCalls
    totalNodes += reduced.getOutput().pathSearchNodes
    if (JSON.stringify(reduced.getOutput().routes) !== JSON.stringify(routes)) displacedRoutes++
  }
  expect(totalSearches).toBeGreaterThan(100)
  expect(totalNodes).toBeGreaterThan(20_000)
  expect(displacedRoutes).toBeGreaterThan(10)
})
