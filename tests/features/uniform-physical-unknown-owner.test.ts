import { expect, test } from "bun:test"
import { createPhysicalUniformScenario } from "../fixtures/createPhysicalUniformScenario"

test("unknown ownership and coincident source coordinates never grant foreign copper access", (): void => {
  for (const connections of [[], [{ name: "a", pointsToConnect: [{ x: 1, y: 0, layer: "top", pointId: "terminal-a" }] }]]) {
    const fixture = createPhysicalUniformScenario({
      obstacles: [{ type: "rect", center: { x: 1, y: 0 }, width: 4, height: 1, layers: ["top"], connectedTo: ["foreign", "pcb_smtpad_foreign"] }],
      rules: { connections },
    })
    expect(() => fixture.solver.solve()).toThrow("No owner-clear ordered placement")
  }
})
