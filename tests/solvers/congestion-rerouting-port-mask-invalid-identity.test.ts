import { expect, test } from "bun:test"
import { createCongestionFixture } from "../../tests/fixtures/congestion-rerouting"
import { getPortSectionMaskForTopology } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/getPortSectionMaskForTopology"

test("fails on missing or duplicate topology identities instead of opening every port", (): void => {
  const { solver } = createCongestionFixture()
  const source = structuredClone(solver.topology)
  source.portMetadata = Array.from({ length: source.portCount }, (_, id) => ({
    serializedPortId: `port-${id}`,
  }))
  const target = {
    ...structuredClone(source),
    portMetadata: structuredClone(source.portMetadata),
  }
  const mask = new Int8Array(source.portCount).fill(1)
  target.portMetadata[0].serializedPortId = "unknown-port"
  expect(() => getPortSectionMaskForTopology(source, mask, target)).toThrow()
  target.portMetadata[0].serializedPortId = "port-0"
  source.portMetadata[1].serializedPortId = "port-0"
  expect(() => getPortSectionMaskForTopology(source, mask, target)).toThrow()
})
