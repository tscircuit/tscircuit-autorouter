import { expect, test } from "bun:test"
import { createPipeline9StaticSegmentValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9StaticSegmentValidator"
import { createPhysicalUniformScenario } from "../fixtures/createPhysicalUniformScenario"

test("physical uniform placement moves a foreign-pad midpoint into the existing legal edge interval", (): void => {
  const fixture = createPhysicalUniformScenario({ obstacles: [{
    type: "rect", center: { x: 0.9, y: 0 }, width: 0.4, height: 0.6,
    layers: ["top"], connectedTo: ["foreign", "pcb_smtpad_foreign"],
  }] })
  const validate = createPipeline9StaticSegmentValidator(fixture.physicalSrj)
  const old = fixture.nodes[0]!.portPoints[0]!
  expect(validate({ start: old, end: old, connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3 })).toBeFalse()
  fixture.solver.solve()
  const point = fixture.solver.getOutput()[0]!.portPoints[0]!
  expect(point.y).toBe(0)
  expect(point.x >= 0 && point.x <= 2).toBeTrue()
  expect(validate({ start: point, end: point, connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3 })).toBeTrue()
  expect(fixture.nodes[0]!.portPoints[0]!.x).toBe(1)
})
