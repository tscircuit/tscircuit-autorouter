import { expect, test } from "bun:test"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("recognized pad clearance checks full through-via copper spans and respects explicit blind spans", (): void => {
  const a = columnRoute("a", [
    { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 1 },
  ], [{ x: 0, y: 0 }])
  const b = columnRoute("b", [{ x: -4, y: 4, z: 0 }, { x: 4, y: 4, z: 0 }])
  const physical = { viaToPadClearance: 0.1, obstacles: [{ type: "rect" as const,
    center: { x: 0.3, y: 0 }, width: 0.2, height: 0.2, layers: ["bottom"], __zLayers: [3],
    connectedTo: ["pcb_smtpad_bottom"], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_bottom" } }] }
  const through = columnPool([a, b], { ...physical, allowBlindAndBuriedVias: false })
  through.offerRoute(a, "native")
  expect(through.params.diagnostics.routeColumnAcceptedColumns ?? 0).toBe(0)
  expect(through.params.diagnostics.routeColumnRejected_viaPad).toBe(1)
  const blind = columnPool([a, b], { ...physical, allowBlindAndBuriedVias: true })
  blind.offerRoute(a, "native")
  expect(blind.params.diagnostics.routeColumnAcceptedColumns).toBe(1)
})
