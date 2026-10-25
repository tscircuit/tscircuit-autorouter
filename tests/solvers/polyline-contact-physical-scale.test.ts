import { expect, test } from "bun:test"
import { MultiHeadPolylineContactSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolylineContactSolver"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("grow/shrink contact coordinates retain physical copper and drill dimensions", (): void => {
  const fixture = createPolylineContactFixture()
  const node = { ...fixture.node, width: fixture.node.width * 2, height: fixture.node.height * 2,
    portPoints: fixture.node.portPoints.map((p) => ({ ...p, x: p.x * 2, y: p.y * 2 })) }
  const solver = new MultiHeadPolylineContactSolver({
    ...fixture.context,
    nodeWithPortPoints: { ...node, portPointsInPairs: [[node.portPoints[0]!, node.portPoints[2]!]] },
    physicalCoordinateScale: 2,
  })
  const candidate = structuredClone(fixture.candidate)
  for (const line of candidate.polyLines) for (const p of [line.start, ...line.mPoints, line.end]) {
    p.x *= 2
    p.y *= 2
  }
  solver.phase = "solving"
  solver.candidates = [candidate]
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.physicalContext.nodeWithPortPoints.portPointsInPairs![0]![1].x).toBe(fixture.node.portPoints[2]!.x)
  const physical = solver.solvedRoutes.map((route) => ({ ...route,
    route: route.route.map((p) => ({ ...p, x: p.x / 2, y: p.y / 2 })),
    vias: route.vias.map((p) => ({ x: p.x / 2, y: p.y / 2 })),
  }))
  expect(physical.every((route): boolean => route.traceThickness === 0.15 && route.viaDiameter === 0.3)).toBe(true)
  expect(validatePolylineContactRoutes(physical, fixture.context)).toBeNull()
})
