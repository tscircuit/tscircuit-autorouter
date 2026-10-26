import { expect, test } from "bun:test"
import type { Obstacle } from "lib/types"
import { createPipeline9StaticSegmentValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9StaticSegmentValidator"
import { createPhysicalUniformScenario } from "../fixtures/createPhysicalUniformScenario"

test("interval placement matches both engine and raw rotated oval plated and hole representations", (): void => {
  const base: Obstacle = { type: "rect", center: { x: 0.85, y: 0 }, width: 0.8, height: 0.25, layers: ["top"], connectedTo: ["foreign", "pcb_smtpad_foreign"] }
  const obstacles: Obstacle[] = [
    { ...base, ccwRotationDegrees: 45 },
    { ...base, type: "oval" } as unknown as Obstacle,
    { ...base, shape: "oval" } as unknown as Obstacle,
    { ...base, width: 0.6, height: 0.6, layers: ["top", "bottom"], connectedTo: ["foreign", "pcb_plated_hole_foreign"] },
    { ...base, width: 0.6, height: 0.6, shape: "circle", isNonPlatedHole: true, ccwRotationDegrees: 37, connectedTo: [] },
  ]
  for (const obstacle of obstacles) {
    const fixture = createPhysicalUniformScenario({ obstacles: [obstacle] })
    fixture.solver.solve()
    const point = fixture.solver.getOutput()[0]!.portPoints[0]!
    expect(createPipeline9StaticSegmentValidator(fixture.physicalSrj)({ start: point, end: point, connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3 })).toBeTrue()
    expect(point.y).toBe(0)
    expect(point.x >= 0 && point.x <= 2).toBeTrue()
  }
})
