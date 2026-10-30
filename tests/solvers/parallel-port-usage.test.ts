import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/DuplicateCongestedPortSolver"
const createRegion = (
  regionId: string,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  pointIds: string[],
): SerializedHyperGraph["regions"][number] => ({
  regionId,
  pointIds,
  d: {
    center: { x: centerX, y: centerY },
    width,
    height,
  },
})

const createPort = (
  portId: string,
  region1Id: string,
  region2Id: string,
  x: number,
  y: number,
): SerializedHyperGraph["ports"][number] => ({
  portId,
  region1Id,
  region2Id,
  d: { x, y, z: 0 },
})


const createDuplicatePortFixture = (): SerializedHyperGraph => ({
  regions: [
    createRegion("a-start", -4, 0, 2, 2, ["a-start-port"]),
    createRegion("b-start", -4, -0.2, 2, 2, ["b-start-port"]),
    createRegion("left", -1, 0, 4, 10, [
      "a-start-port",
      "b-start-port",
      "shared-choke",
      "shared-neighbor",
    ]),
    createRegion("right", 1, 0, 4, 10, [
      "shared-choke",
      "shared-neighbor",
      "a-end-port",
      "b-end-port",
    ]),
    createRegion("a-end", 4, 0, 2, 2, ["a-end-port"]),
    createRegion("b-end", 4, -0.2, 2, 2, ["b-end-port"]),
  ],
  ports: [
    createPort("a-start-port", "a-start", "left", -3, 0),
    createPort("b-start-port", "b-start", "left", -3, -0.2),
    createPort("shared-choke", "left", "right", 0, 0),
    createPort("shared-neighbor", "left", "right", 0, 4),
    createPort("a-end-port", "right", "a-end", 3, 0),
    createPort("b-end-port", "right", "b-end", 3, -0.2),
  ],
  connections: [
    {
      connectionId: "connection-a",
      startRegionId: "a-start",
      endRegionId: "a-end",
      mutuallyConnectedNetworkId: "net-a",
    },
    {
      connectionId: "connection-b",
      startRegionId: "b-start",
      endRegionId: "b-end",
      mutuallyConnectedNetworkId: "net-b",
    },
  ],
})


test("independent port usage workers preserve duplication geometry and reports", async () => {
  const input = createDuplicatePortFixture()
  for (const workerCount of [1, 4]) {
    const runtime = new SolverRuntime({
      workerCount,
      workerUrl: new URL("../../lib/runtime/node.worker.ts", import.meta.url),
      requireWorker: true,
    })
    try {
      for (const useSerializedPortPenalties of [false, true]) {
        const options = { duplicatePortProximity: 0.2, useSerializedPortPenalties }
        const serial = new DuplicateCongestedPortSolver(structuredClone(input), options)
        serial.solve()
        const parallel = new DuplicateCongestedPortSolver(structuredClone(input), options)
        await parallel.solveAsync(runtime)
        expect(serial.solved).toBe(true)
        expect(parallel.solved).toBe(true)
        expect(parallel.failed).toBe(false)
        expect(parallel.report).toEqual(serial.report)
        expect(parallel.getOutput()).toEqual(serial.getOutput())
        expect(parallel.iterations).toBe(serial.iterations)
        expect(parallel.report.duplicatedPorts.length).toBeGreaterThan(0)
      }
    } finally {
      await runtime.dispose()
    }
  }
})
