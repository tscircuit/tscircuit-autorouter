import { expect, test } from "bun:test"
import { collectPolylineContacts, type ContactPrimitive } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/polylineContactGeometry"

test("coincident same-net vias remain contacts when their movement variables are independent", (): void => {
  const primitives: ContactPrimitive[] = [0, 2].map((variable) => ({
    vertices: [{ point: { x: 0, y: 0 }, variable }], radius: 0.15,
    owner: 0, minZ: 0, maxZ: 3, via: true,
  }))
  const rules = { margin: 0.1, viaGap: 0.1, drillSeparation: 0.5, sameNet: (): boolean => true }
  const independent = collectPolylineContacts(primitives, rules, 0.2)
  expect(independent.contacts).toHaveLength(1)
  expect(independent.contacts[0]!.required).toBe(0.5)
  primitives[1]!.vertices[0]!.variable = 0
  expect(collectPolylineContacts(primitives, rules, 0.2).contacts).toHaveLength(0)
  for (const primitive of primitives) primitive.vertices[0]!.variable = -1
  expect(collectPolylineContacts(primitives, rules, 0.2).contacts).toHaveLength(0)
})
