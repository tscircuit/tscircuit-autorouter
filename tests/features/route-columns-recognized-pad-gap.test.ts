import { expect, test } from "bun:test"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("recognized SMT-pad via clearance uses actual copper and dedicated physical-unit gaps", (): void => {
  for (const scale of [0.5, 1, 2]) {
    const a = columnRoute("a", [
      { x: -scale, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 }, { x: -scale, y: 0, z: 1 },
    ], [{ x: 0, y: 0 }])
    a.traceThickness = 0.1 * scale
    a.viaDiameter = 0.3 * scale
    const b = columnRoute("b", [{ x: -4, y: 4, z: 0 }, { x: 4, y: 4, z: 0 }])
    const physical = {
      traceWidth: a.traceThickness, viaDiameter: a.viaDiameter,
      viaHoleDiameter: 0.15 * scale, obstacleMargin: 0.1 * scale,
      obstacles: [{ type: "rect" as const, center: { x: 0.3 * scale, y: 0 },
        width: 0.2 * scale, height: 0.2 * scale, layers: ["top"], __zLayers: [0],
        connectedTo: ["pcb_smtpad_other"], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_other" } }],
    }
    const relaxed = columnPool([a, b], { ...physical, viaToPadClearance: 0.04 * scale })
    relaxed.offerRoute(a, "native")
    expect(relaxed.params.diagnostics.routeColumnAcceptedColumns).toBe(1)
    const required = columnPool([a, b], { ...physical, viaToPadClearance: 0.1 * scale })
    required.offerRoute(a, "native")
    expect(required.params.diagnostics.routeColumnAcceptedColumns ?? 0).toBe(0)
    expect(required.params.diagnostics.routeColumnRejected_viaPad).toBe(1)
    const wire = { ...a, route: a.route.slice(0, 2), vias: [] }
    const wireOnly = columnPool([wire, b], { ...physical, viaToPadClearance: 0.1 * scale })
    wireOnly.offerRoute(wire, "native")
    expect(wireOnly.params.diagnostics.routeColumnAcceptedColumns).toBe(1)
  }
})
