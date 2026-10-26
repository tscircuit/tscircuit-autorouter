import { expect, test } from "bun:test"
import { getOrderedSharedEdgeSchedule, type OrderedSharedEdgePort } from "lib/solvers/UniformPortDistributionSolver/getOrderedSharedEdgeSchedule"

test("sample24 edge46689 rejects its inherited owner order while the reverse order is feasible", (): void => {
  const ports: OrderedSharedEdgePort[] = [
    { owner: "connectivity_net88", connectionName: "source_net_altium_pcb_89_mst0", width: 0.1, allowed: [[0.14500000000000984, 0.3906012000000487]] },
    { owner: "connectivity_net51", connectionName: "source_net_altium_pcb_52", width: 0.1, allowed: [[0.14500000000000984, 0.24560120000001046]] },
  ]
  const rules = { length: 0.3906012000000487, traceClearance: 0.1, tolerance: 0.005 }
  const inherited = getOrderedSharedEdgeSchedule({ ...rules, ports })
  expect(inherited.feasible).toBe(false)
  if (inherited.feasible) throw new Error("Expected the original fixed order to be impossible")
  expect(inherited.failedIndex).toBe(0)
  expect(inherited.gaps[0]![1]).toBeCloseTo(0.195, 12)
  const reverse = getOrderedSharedEdgeSchedule({ ...rules, ports: ports.toReversed() })
  expect(reverse.feasible).toBe(true)
  if (!reverse.feasible) throw new Error("Expected the reversed witness order to fit")
  expect(reverse.latest[1]! - reverse.latest[0]!).toBeGreaterThanOrEqual(0.195)
  expect(reverse.latest[0]).toBeGreaterThanOrEqual(ports[1]!.allowed[0]![0])
  expect(reverse.latest[0]).toBeLessThanOrEqual(ports[1]!.allowed[0]![1])
  expect(ports[0]!.connectionName).toBe("source_net_altium_pcb_89_mst0")
})
