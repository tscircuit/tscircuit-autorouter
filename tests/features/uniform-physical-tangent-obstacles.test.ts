import { expect, test } from "bun:test"
import { PhysicalSharedEdgePlacement } from "lib/solvers/UniformPortDistributionSolver/PhysicalSharedEdgePlacement"
import { getPipeline9PhysicalGeometryContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalGeometryContext"
import { createPhysicalUniformScenario } from "../fixtures/createPhysicalUniformScenario"

test("foreign-pad offsets preserve a usable tangent singleton and a one-tenth-nanometre gap", (): void => {
  for (const gap of [0, 1e-10]) {
    const fixture = createPhysicalUniformScenario({
      length: 1,
      ports: [{ portPointId: "only", connectionName: "a", x: 0.5, y: 0, z: 0 }],
      rules: { minTraceWidth: 0.125, minTraceToPadEdgeClearance: 0.005 },
      obstacles: [-0.0625, 1.0625 + gap].map((x, i) => ({
        type: "rect",
        center: { x, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: [`foreign-${i}`, `pcb_smtpad_foreign_${i}`],
      })),
    })
    const edge = [...fixture.solver.mapOfOwnerPairToSharedEdge.values()][0]!
    const owner = getPipeline9PhysicalGeometryContext(
      fixture.physicalSrj,
    ).connMap.getNetConnectedToId("a")
    const allowed = new PhysicalSharedEdgePlacement(
      fixture.physicalSrj,
    ).getAllowedIntervals(edge, { owner, width: 0.125, z: 0 })
    expect(allowed.length).toBe(1)
    expect(allowed[0]![0]).toBe(0.5)
    expect(allowed[0]![1]).toBeCloseTo(0.5 + gap, 14)
    fixture.solver.solve()
    const point = fixture.solver.getOutput()[0]!.portPoints[0]!
    expect(point.x >= 0.5 && point.x <= 0.5 + gap + 1e-15).toBeTrue()
  }
})
