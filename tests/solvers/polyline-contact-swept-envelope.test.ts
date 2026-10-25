import { expect, test } from "bun:test"
import { collectPolylineContacts, type ContactPrimitive } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/polylineContactGeometry"

test("swept contacts include diagonal trust-box motion and certify distant omissions", (): void => {
  const primitives: ContactPrimitive[] = [0, 0.47, 10].map((x, owner) => ({
    vertices: [{ point: { x, y: x }, variable: owner * 2 }], radius: 0.1,
    owner, minZ: 0, maxZ: 0, via: false,
  }))
  const result = collectPolylineContacts(primitives, {
    margin: 0.1, viaGap: 0.1, drillSeparation: 0.4, sameNet: (a, b): boolean => a === b,
  }, 0.15)
  // Distance .66468 is above c + 2*.15, but below c + 2*sqrt(2)*.15.
  expect(result.contacts).toHaveLength(1)
  expect(result.contacts[0]!.a.owner).toBe(0)
  expect(result.contacts[0]!.b.owner).toBe(1)
  expect(result.envelopePairs).toBe(1)
})
