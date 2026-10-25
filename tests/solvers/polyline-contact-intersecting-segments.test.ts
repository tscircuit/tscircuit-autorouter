import { expect, test } from "bun:test"
import { ContactHalfspaceSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/ContactHalfspaceSolver"
import { buildPolylineContactRows, contactPrimitiveDistance, type ContactPrimitive } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/polylineContactGeometry"

test("an explicit crossing side solves whole-segment separation instead of a zero distance gradient", (): void => {
  const a: ContactPrimitive = {
    vertices: [{ point: { x: 0, y: -1 }, variable: 0 }, { point: { x: 0, y: 1 }, variable: 2 }],
    radius: 0.1, minZ: 0, maxZ: 0, owner: 0, via: false,
  }
  const b: ContactPrimitive = {
    vertices: [{ point: { x: -1, y: 0 }, variable: 4 }, { point: { x: 1, y: 0 }, variable: 6 }],
    radius: 0.1, minZ: 0, maxZ: 0, owner: 1, via: false,
  }
  expect(contactPrimitiveDistance(a, b)).toBe(0)
  const rows = buildPolylineContactRows({ a, b, required: 0.3, distance: 0 }, 0)
  expect(rows).toHaveLength(4)
  const solver = new ContactHalfspaceSolver(8, rows, 1e8, 20_000)
  solver.solve()
  const result = solver.getOutput()
  if (result.status !== "projected") throw new Error("No checked crossing proposal")
  for (const vertex of [...a.vertices, ...b.vertices]) {
    vertex.point.x += result.displacement[vertex.variable]!
    vertex.point.y += result.displacement[vertex.variable + 1]!
  }
  expect(contactPrimitiveDistance(a, b)).toBeGreaterThanOrEqual(0.3)
})
