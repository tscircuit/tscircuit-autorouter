import { expect, test } from "bun:test"
import { createCongestionFixture } from "../../tests/fixtures/congestion-rerouting"
import { getPortSectionMaskForTopology } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/getPortSectionMaskForTopology"

test("rejects duplicate target ports and nonbinary original permissions", (): void => {
  const { solver } = createCongestionFixture()
  const source = structuredClone(solver.topology)
  source.portMetadata = Array.from({ length: source.portCount }, (_, i) => ({ serializedPortId: `port-${i}` }))
  const target = structuredClone(source)
  const mask = new Int8Array(source.portCount).fill(1)
  target.portMetadata![1].serializedPortId = "port-0"
  expect(() => getPortSectionMaskForTopology(source, mask, target)).toThrow()
  mask[0] = -1
  expect(() => getPortSectionMaskForTopology(source, mask, source)).toThrow()
})
