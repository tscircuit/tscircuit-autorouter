import { expect, test } from "bun:test"
import { MultiHeadPolylineContactSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolylineContactSolver"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("grow/shrink model preparation preserves the physical recognized-pad via rule", (): void => {
  const { context, node } = createPolylineContactFixture()
  const routes = [{
    connectionName: "a", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 1 }],
    vias: [{ x: 0, y: 0 }],
  }]
  for (const scale of [0.5, 1, 2, 4]) {
    const solver = new MultiHeadPolylineContactSolver({
      ...context, viaToPadClearance: 0.1, physicalCoordinateScale: scale,
      nodeWithPortPoints: { ...node, width: node.width * scale, height: node.height * scale,
        portPoints: node.portPoints.map((point) => ({ ...point, x: point.x * scale, y: point.y * scale })) },
      obstacles: [{ type: "rect", center: { x: 0.3, y: 0 }, width: 0.2, height: 0.2,
        layers: ["top"], connectedTo: ["pcb_smtpad_other"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_other" } }],
    })
    solver.step()
    expect(solver.physicalContext.nodeWithPortPoints.width).toBe(node.width)
    expect(validatePolylineContactRoutes(routes, solver.physicalContext)).toContain("Via")
    expect(validatePolylineContactRoutes(routes, { ...solver.physicalContext, viaToPadClearance: 0.04 })).toBeNull()
  }
})
