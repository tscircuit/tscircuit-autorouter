import { expect, test } from "bun:test"
import { createCongestionFixture } from "../../tests/fixtures/congestion-rerouting"
import { getPortSectionMaskForTopology } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/getPortSectionMaskForTopology"

test("remaps original restrictions by identity when topology port order differs", (): void => {
  const { solver } = createCongestionFixture()
  const source = structuredClone(solver.topology)
  source.portMetadata = Array.from({ length: source.portCount }, (_, id) => ({ serializedPortId: `port-${id}` }))
  const target = structuredClone(source)
  target.portMetadata.reverse()
  const originalMask = new Int8Array(source.portCount).fill(1)
  originalMask[2] = 0
  const restored = getPortSectionMaskForTopology(source, originalMask, target)
  expect(restored[target.portCount - 3]).toBe(0)
  expect([...restored].filter(v => v === 1)).toHaveLength(source.portCount - 1)
  expect(originalMask[2]).toBe(0)
})
