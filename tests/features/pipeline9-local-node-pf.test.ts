import { SolverRuntime } from "@tscircuit/solver-utils"
import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPipeline9RegularNodeSolver,
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("local HD solves retain only their node metadata without changing serial or batched routes", async (): Promise<void> => {
  const nodes = Array.from(
    { length: 9 },
    (_, index): NodeWithPortPoints => ({
      capacityMeshNodeId: index === 8 ? "toString" : `node_${index}`,
      center: { x: index * 4, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0],
      portPoints: [
        { x: index * 4 - 0.6, y: 0, z: 0, connectionName: `signal_${index}` },
        { x: index * 4 + 0.6, y: 0, z: 0, connectionName: `signal_${index}` },
      ],
    }),
  )
  const nodePfs = new Map<CapacityMeshNodeId, number | null>()
  for (let index = 0; index < 512; index++) {
    nodePfs.set(`unrelated_${index}`, 0.9)
  }
  for (let index = 0; index < nodes.length - 1; index++) {
    nodePfs.set(nodes[index].capacityMeshNodeId, index % 2 === 0 ? 0 : null)
  }
  const nodePfRecord: Record<CapacityMeshNodeId, number | null> =
    Object.fromEntries(nodePfs)
  Object.defineProperty(nodePfRecord, "node_7", {
    value: 0.7,
    enumerable: false,
  })
  const originalRecordEntries = Object.entries(nodePfRecord)
  const recordPfs = new Map<CapacityMeshNodeId, number | null>(
    originalRecordEntries,
  )
  const originalEntries = [...nodePfs]
  for (const nodePfById of [nodePfs, nodePfRecord]) {
    const params: Pipeline9HighDensitySolverParams = {
      nodePortPoints: nodes,
      nodePfById,
      fixedHdRoutes: [],
      connMap: new ConnectivityMap({}),
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      effort: 0.1,
    }
    for (const node of nodes) {
      const local = createPipeline9RegularNodeSolver({
        ...params,
        nodeWithPortPoints: node,
        nodePfById,
        colorMap: {},
      })
      expect(local.nodePfById.size).toBe(1)
      local.solve()
      expect(local.solved).toBeTrue()
      expect(
        local.nodeSolveMetadataById.get(node.capacityMeshNodeId)?.nodePf,
      ).toBe(
        (nodePfById instanceof Map ? nodePfs : recordPfs).get(
          node.capacityMeshNodeId,
        ) ?? null,
      )
    }
    const serial = new Pipeline9HighDensitySolver(params)
    serial.solve()
    expect(serial.solved).toBeTrue()
    const batched = new Pipeline9HighDensitySolver(params)
    const runtime = new SolverRuntime()
    const dispatch = spyOn(runtime, "executeAsync")
    try {
      await batched.solveAsync(runtime)
      expect(batched.solved).toBeTrue()
      expect(batched.routes).toEqual(serial.routes)
      expect(batched.stats).toEqual(serial.stats)
      expect(batched.iterations).toBe(serial.iterations)
      expect(dispatch).toHaveBeenCalledTimes(3)
    } finally {
      dispatch.mockRestore()
      await runtime.dispose()
    }
  }
  expect([...nodePfs]).toEqual(originalEntries)
  expect(Object.entries(nodePfRecord)).toEqual(originalRecordEntries)
})
