import { expect, test } from "bun:test"
import { EventTileSearchKernel } from "lib/solvers/HighDensitySolver/EventTileSearchKernel"
import { HighDensitySolverA13EventTiles } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13EventTiles"
import { emptyEventInput } from "./eventTileTestUtils"

test("event search rejects unsupported layouts, nonfinite fields and fractional budgets without a hidden strategy switch", (): void => {
  expect(() => new EventTileSearchKernel(0, 4, 2, 0.1, 0.1)).toThrow()
  const input = emptyEventInput(3, 3, 2)
  const kernel = new EventTileSearchKernel(3, 3, 2, 0.1, 0.1)
  expect(() => kernel.run(1, 100)).toThrow()
  expect(() => kernel.begin(input, 0, 18, 0.5)).toThrow()
  expect(() => kernel.begin({ ...input, fixed: new Uint8Array(17) }, 0, 17, 0.5)).toThrow()
  kernel.begin(input, 0, 17, 0.5)
  expect(() => kernel.run(1, 0.5)).toThrow()
  input.history[4] = NaN
  expect(() => kernel.run(100, 100)).toThrow("finite nonnegative")
  const solver = new HighDensitySolverA13EventTiles({
    nodeWithPortPoints: {
      capacityMeshNodeId: "pinned-layout-contract",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [{ connectionName: "a", x: -1, y: 0, z: 0 }, { connectionName: "a", x: 1, y: 0, z: 1 }],
    },
    layerCount: 2,
    obstacles: [],
  })
  let unsupportedTraceCost = new Float64Array(0)
  Object.defineProperty(solver, "traceCost", {
    configurable: true,
    get: (): Float64Array => unsupportedTraceCost,
    set: (value: Uint16Array): void => { unsupportedTraceCost = new Float64Array(value.length) },
  })
  expect(() => solver._setup()).toThrow("traceCost layout")
  expect(solver.eventKernel).toBeNull()
})
