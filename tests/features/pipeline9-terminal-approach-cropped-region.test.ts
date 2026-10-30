import {
  extractRepairRegion,
  mergeRepairRegion,
  NegotiateTraceClearanceSolver,
} from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { removeCopiedPipeline9TerminalApproaches } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/removeCopiedPipeline9TerminalApproaches"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("cropped repairs retain approach tags only at original anchor coordinates", (): void => {
  for (const withJunction of [false, true]) {
    const fixture = createBoundedRegionalRepairFixture()
    fixture.originalSrj.bounds = {
      minX: -12,
      maxX: 12,
      minY: -8,
      maxY: 8,
    }
    fixture.originalSrj.obstacles[0]!.center.x = -10
    fixture.originalSrj.obstacles[1]!.center.x = 10
    fixture.originalSrj.connections[0]!.pointsToConnect[0]!.x = -10
    fixture.originalSrj.connections[0]!.pointsToConnect[1]!.x = 10
    fixture.routes[0]!.route = [
      { x: -10, y: 0, z: 0, pcb_port_id: "start" },
      { x: -9.9, y: 0.1, z: 0, terminalApproach: "start" },
      { x: 9.9, y: 0.1, z: 0, terminalApproach: "end" },
      { x: 10, y: 0, z: 0, pcb_port_id: "end" },
    ]
    if (withJunction) {
      fixture.routes.push({
        connectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        vias: [],
        route: [
          { x: 2, y: 0.1, z: 0 },
          { x: 2, y: 2, z: 0 },
        ],
      })
    }
    const original = structuredClone(fixture.routes)
    const region = extractRepairRegion({
      srj: { ...fixture.originalSrj, traces: undefined },
      routes: fixture.routes,
      bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    })
    const localRoutes: HighDensityRoute[] = region.routes
    // Both real approaches are outside the crop. These tags were copied onto
    // cuts and, optionally, a T junction that repair04 already keeps fixed.
    expect(localRoutes[0]!.route.length).toBe(withJunction ? 5 : 4)
    for (const [pointIndex, point] of localRoutes[0]!.route.entries()) {
      expect(point.terminalApproach).toBe("start")
      expect(region.lockedPointIndices[0]![pointIndex]).toBeTrue()
    }
    const originalRegion = structuredClone(region)
    const negotiation = new NegotiateTraceClearanceSolver({
      srj: region.srj,
      routes: localRoutes,
      bounds: region.mutableBounds,
      dirtyRouteIndices: [0],
      isLocked: (routeIndex, pointIndex): boolean =>
        region.lockedPointIndices[routeIndex]![pointIndex]!,
      allowLayerChanges: true,
      traceClearance: 0.1,
      viaClearance: 0.1,
      maxPathSearchCalls: 64,
      maxPathSearchNodes: 100_000,
    })
    negotiation.solve()
    expect(negotiation.failed).toBeFalse()
    const rawMerged: HighDensityRoute[] = mergeRepairRegion({
      routes: fixture.routes,
      region,
      repairedRoutes: negotiation.getOutput().routes,
    })
    expect(
      rawMerged[0]!.route.filter((point) => point.terminalApproach).length,
    ).toBeGreaterThan(2)
    const cleaned = removeCopiedPipeline9TerminalApproaches(
      fixture.routes,
      rawMerged,
    )
    expect(region).toEqual(originalRegion)
    expect(cleaned[0]!.route.filter((point) => point.terminalApproach)).toEqual(
      original[0]!.route.slice(1, -1),
    )
    for (const [routeIndex, route] of cleaned.entries()) {
      expect(route.route).toHaveLength(rawMerged[routeIndex]!.route.length)
      for (const [pointIndex, point] of route.route.entries()) {
        const raw = rawMerged[routeIndex]!.route[pointIndex]!
        expect({ ...point, terminalApproach: undefined }).toEqual({
          ...raw,
          terminalApproach: undefined,
        })
      }
    }
    const solver = new Pipeline9BoundedRegionalRepairSolver(fixture)
    solver.solve()
    expect(solver.failed).toBeFalse()
    const result = solver.getResult()
    expect(result.acceptedRegionCount).toBe(1)
    expect(result.routes).toEqual(cleaned)
    const reference = fixture.drcEvaluator({
      traces: [],
      routes: result.routes,
    })
    expect(Array.isArray(reference) ? reference : reference.errors).toEqual([])
    expect(fixture.routes).toEqual(original)
    expect(
      removeCopiedPipeline9TerminalApproaches(fixture.routes, cleaned),
    ).toBe(cleaned)
  }
})
