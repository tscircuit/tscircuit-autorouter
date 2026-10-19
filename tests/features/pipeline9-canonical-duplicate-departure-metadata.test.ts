import { expect, test } from "bun:test"
import {
  extractRepairRegion,
  mergeRepairRegion,
  NegotiateTraceClearanceSolver,
} from "@tscircuit/repair04"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RepairSrj = Parameters<typeof extractRepairRegion>[0]["srj"]

test("canonical duplicate points preserve the departure's plated-hole or via identity through regional repair", (): void => {
  for (const throughHole of [false, true]) {
    const departureMetadata = {
      toNextSegmentType: "through_obstacle" as const,
      toNextSegmentCircuitJsonMetadata: { pcb_plated_hole_id: "hole" },
    }
    const route: HighDensityRoute = {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -5.25, y: 0, z: 0, pcb_port_id: "start" },
        { x: -4.75, y: 0, z: 0 },
        { x: -4.75, y: 0, z: 1 },
        { x: 4.75, y: 0, z: 1, ...(!throughHole ? departureMetadata : {}) },
        { x: 4.75, y: 0, z: 1, ...(throughHole ? departureMetadata : {}) },
        { x: 4.75, y: 0, z: 2 },
        { x: 5.25, y: 0, z: 2, pcb_port_id: "end" },
      ],
      vias: [{ x: -4.75, y: 0 }, ...(!throughHole ? [{ x: 4.75, y: 0 }] : [])],
    }
    const before = structuredClone(route)
    const canonical = canonicalizePipeline9HdRoutes([route])
    expect(route).toEqual(before)
    const srj: RepairSrj = {
      layerCount: 4,
      minTraceWidth: 0.1,
      bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
      obstacles: [],
      connections: [],
    }
    const region = extractRepairRegion({
      srj,
      routes: canonical,
      bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    })
    const solver = new NegotiateTraceClearanceSolver({
      srj: region.srj,
      routes: region.routes,
      bounds: region.mutableBounds,
      dirtyRouteIndices: [],
      isLocked: (routeIndex, pointIndex): boolean =>
        region.lockedPointIndices[routeIndex]![pointIndex]!,
      maxPathSearchCalls: 0,
      maxPathSearchNodes: 0,
      traceClearance: 0.1,
      viaClearance: 0.1,
      allowLayerChanges: true,
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    const merged = mergeRepairRegion({
      routes: canonical,
      region,
      repairedRoutes: solver.getOutput().routes,
    })
    expect(canonical[0]!.route).toHaveLength(6)
    expect(canonical[0]!.route[3]).toEqual(route.route[4])
    expect(merged[0]!.vias).toEqual(route.vias)
    expect(merged[0]!.route[0]).toEqual(route.route[0])
    expect(merged[0]!.route.at(-1)).toEqual(route.route.at(-1))
    expect(merged[0]!.route.some((point) => point.toNextSegmentType === "through_obstacle")).toBe(throughHole)
  }
  for (const distinct of [
    { pcb_port_id: "other-terminal" },
    { traceThickness: 0.2 },
    { insideJumperPad: true },
  ]) {
    const point = { x: 0, y: 0, z: 0, pcb_port_id: "terminal", traceThickness: 0.1 }
    const route: HighDensityRoute = {
      connectionName: "distinct-point-metadata",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [point, { ...point, ...distinct }],
      vias: [],
    }
    expect(canonicalizePipeline9HdRoutes([route])[0]!.route).toEqual(route.route)
  }
})
