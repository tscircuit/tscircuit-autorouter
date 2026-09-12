import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "high-density-repair03/lib"
import { initializeAutorouterBindings } from "../lib/bindings/initializeAutorouterBindings"
import * as bindings from "../rust/autorouter-bindings/pkg/autorouter_bindings.js"

test("typed repair bindings preserve JSON metadata, numeric results, and identity indices", (): void => {
  initializeAutorouterBindings()
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 2, minTraceWidth: 0.1, obstacles: [], connections: [],
  }
  const routes: HighDensityRoute[] = [0, 0.12].map((x, index) => ({
    connectionName: index === 0 ? "a" : "b",
    traceThickness: 0.1, viaDiameter: 0.3, vias: [{ x, y: 0 }],
    route: [
      { x: -1, y: index * 0.4, z: 0 },
      { x, y: 0, z: 0 },
      { x, y: 0, z: 1 },
      { x: 1, y: index * 0.4, z: 1 },
    ].map((point) => ({
      ...point, absent: undefined,
      metadata: { absent: undefined, nullable: null, values: [undefined, -0, NaN, 1e20] },
    })),
  }))
  const before = JSON.stringify(routes)
  const engine = new bindings.TargetedRepairEngine(srj, null)
  try {
    const result = engine.applyForces({
      routes,
      errors: [{
        type: "pcb_via_clearance_error", center: { x: 0.06, y: 0 },
        pcb_via_ids: ["via_a", "via_b"], pcb_via_pair_net_relation: "different_net",
      }],
      traceMap: { trace_a: 0, trace_b: 1 },
    }, 1, true, false, true, false)
    const expectedRoutes = routes.map((route, index) => ({
      ...route,
      route: route.route.map((point, pointIndex) => ({
        ...point, x: pointIndex === 1 || pointIndex === 2 ? [-0.16, 0.28][index] : point.x,
      })),
    }))
    expect(JSON.stringify(result)).toBe(JSON.stringify({
      changed: true, routes: expectedRoutes,
      routeIndexes: [0, 1], pointOrigins: [[0, 1, 2, 3], [0, 1, 2, 3]],
    }))
    expect(Object.hasOwn(result.routes[0].route[0], "absent")).toBe(false)
    expect(JSON.stringify(routes)).toBe(before)

    const padInput = { route: routes[0], preferred: { x: 0.5, y: 0.5 }, zLayers: [0, 1] as const }
    expect(engine.pad(padInput, 0.15)).toEqual({ point: padInput.preferred, isPreferred: true })
    expect(engine.pad(padInput, 3)).toEqual({ point: null, isPreferred: false })

    const traceInput: bindings.RepairTraceInput = {
      via: { routeIndex: 0, rootConnectionName: "a", pointIndexes: [1, 2], zLayers: [0, 1],
        x: 0.1, y: 0.2, radius: 0.15, movable: true, canCanonicalize: true },
      segments: [], connectivity: null,
    }
    expect(bindings.TargetedRepairEngine.trace(traceInput, 0.1)).toEqual({
      points: [{ x: 0.1, y: 0.2 }], viaIdentityIndices: [0],
    })
    expect(() => bindings.TargetedRepairEngine.trace({
      ...traceInput,
      // @ts-expect-error Generated input types reject nonnumeric coordinates.
      via: { ...traceInput.via, x: "invalid" },
    }, 0.1)).toThrow()
    expect(bindings.TargetedRepairEngine.trace(traceInput, Infinity).points[0].x).toBe(0.1)
    expect(engine.pad(padInput, Infinity)).toEqual({ point: null, isPreferred: false })
  } finally {
    engine.free()
  }
})
