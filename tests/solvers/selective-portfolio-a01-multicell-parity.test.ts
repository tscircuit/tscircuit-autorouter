import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { EndpointPreservingHighDensitySolverA01 } from "lib/solvers/HyperHighDensitySolver/EndpointPreservingHighDensitySolverA01"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("the endpoint wrapper preserves existing multi-cell search and output exactly", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "multicell-parity",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -0.9, y: -0.6, z: 0 },
      { connectionName: "A", x: 0.9, y: 0.6, z: 1 },
    ],
  }
  const params = { nodeWithPortPoints: node, cellSizeMm: 0.1, traceThickness: 0.1, viaDiameter: 0.3 }
  const original = new HighDensitySolverA01(params)
  const wrapped = new EndpointPreservingHighDensitySolverA01(params)
  original.solve()
  wrapped.solve()
  expect(original.solved).toBe(true)
  expect(wrapped.solved).toBe(true)
  expect(wrapped.iterations).toBe(original.iterations)
  expect(wrapped.MAX_ITERATIONS).toBe(original.MAX_ITERATIONS)
  expect(JSON.stringify(wrapped.getOutput())).toBe(JSON.stringify(original.getOutput()))
  expect(wrapped.getOutput()[0]!.route.length).toBeGreaterThan(2)
})
