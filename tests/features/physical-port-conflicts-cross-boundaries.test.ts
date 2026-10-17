import { expect, test } from "bun:test"
import { getPhysicalPortConflicts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getPhysicalPortConflicts"

test("nearby ports conflict regardless of boundary identity but not across layers", (): void => {
  expect(getPhysicalPortConflicts({
    portX: new Float64Array([0, 0.05, 0.05, 1]),
    portY: new Float64Array([0, 0, 0, 0]),
    portZ: new Int32Array([0, 0, 1, 0]),
  }, 0.1524)).toEqual([[1], [0], [], []])
})
