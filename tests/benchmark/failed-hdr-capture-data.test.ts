import { expect, test } from "bun:test"
import { serializeFailedHdrInput } from "../../scripts/benchmark/capture-failed-hdr"

test("HDR capture preserves actual retained constructor data and connectivity without solver calls", () => {
  const node = { capacityMeshNodeId: "partial__z_2", availableZ: [2], portPoints: [{ x: 1, y: 2, z: 2 }] }
  let methodCalls = 0
  const connMap = { netMap: { pad1: "net1" }, getNetConnectedToId: () => { methodCalls++; return "net1" } }
  const params = { nodePortPoints: [node], connMap, obstacles: [{ width: 0.3, connectedTo: ["pad1"] }],
    nodePfById: new Map([[node.capacityMeshNodeId, 0.1]]), names: new Set(["net1"]),
    typed: new Int32Array([-1, 2]), max: Infinity, missing: undefined }
  class Hdr { constructor(readonly params: unknown) {} solve() { methodCalls++; throw new Error("must not run") } }
  const source = new Hdr(params)
  const data = JSON.parse(serializeFailedHdrInput({ solverName: "pipeline9", scenarioName: "sample024", sampleNumber: 24 }, source,
    "Failed to solve 1 nodes, partial__z_2. err0: actual clearance failure")!)
  expect(data.constructorName).toBe("Hdr")
  expect(data.failedNodeIds).toEqual([node.capacityMeshNodeId])
  expect(data.matchingFailedNodes).toEqual([node])
  expect(data.constructorParams.nodePortPoints).toEqual([node])
  expect(data.constructorParams.obstacles).toEqual(params.obstacles)
  expect(data.constructorParams.connMap).toEqual({ __captureType: "ConnectivityMap", netMap: connMap.netMap })
  expect(data.constructorParams.nodePfById).toEqual({ __captureType: "Map", entries: [[node.capacityMeshNodeId, 0.1]] })
  expect(data.constructorParams.names).toEqual({ __captureType: "Set", values: ["net1"] })
  expect(data.constructorParams.typed).toEqual({ __captureType: "Int32Array", values: [-1, 2] })
  expect(data.constructorParams.max).toEqual({ __captureType: "Number", value: "Infinity" })
  expect(data.constructorParams.missing).toEqual({ __captureType: "Undefined" })
  expect(source.params).toBe(params)
  expect(params.nodePortPoints[0]).toBe(node)
  expect(methodCalls).toBe(0)
  expect(serializeFailedHdrInput({ solverName: "x", scenarioName: "y", sampleNumber: 24 }, undefined, "no HDR")).toBeUndefined()
})
