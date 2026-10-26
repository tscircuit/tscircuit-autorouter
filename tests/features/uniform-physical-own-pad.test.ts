import { expect, test } from "bun:test"
import { createPhysicalUniformScenario } from "../fixtures/createPhysicalUniformScenario"

test("declared same-owner copper does not block shared-port placement", (): void => {
  const fixture = createPhysicalUniformScenario({
    obstacles: [
      {
        type: "rect",
        center: { x: 1, y: 0 },
        width: 3,
        height: 1,
        layers: ["top"],
        connectedTo: ["a", "pcb_smtpad_own"],
      },
    ],
  })
  fixture.solver.solve()
  expect(fixture.solver.solved).toBeTrue()
  expect(
    fixture.solver.getOutput().map((node) => node.portPoints[0]!.x),
  ).toEqual([1, 1])
})
