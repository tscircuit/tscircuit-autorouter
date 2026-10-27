import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { splitPartialLayerRegions } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/splitPartialLayerRegions"

function terminalTargetGraph(layers: number[]): SerializedHyperGraph {
  return {
    regions: [
      { regionId: "pad-domain", pointIds: ["original-U1.1", "original-U2.1"],
        d: { capacityMeshNodeId: "pad-domain", center: { x: 0, y: 0 }, width: 2, height: 2,
          availableZ: layers, netId: 0, _containsTarget: true, custom: { preserve: [1, 2] } } },
      { regionId: "left", pointIds: ["original-U1.1"],
        d: { capacityMeshNodeId: "left", center: { x: -2, y: 0 }, width: 2, height: 2, availableZ: [2], netId: 0 } },
      { regionId: "right", pointIds: ["original-U2.1"],
        d: { capacityMeshNodeId: "right", center: { x: 2, y: 0 }, width: 2, height: 2, availableZ: [2], netId: 0 } },
    ],
    ports: [
      { portId: "original-U1.1", region1Id: "pad-domain", region2Id: "left",
        d: { x: -1, y: .125, z: 2, portId: "original-U1.1", pcb_port_id: "pcb-U1.1", _tinyTerminal: true } },
      { portId: "original-U2.1", region1Id: "pad-domain", region2Id: "right",
        d: { x: 1, y: -.125, z: 2, portId: "original-U2.1", pcb_port_id: "pcb-U2.1", _tinyTerminal: true } },
    ],
    connections: [{ connectionId: "net0-original-obligation", mutuallyConnectedNetworkId: "net0",
      startRegionId: "pad-domain", endRegionId: "pad-domain" }],
    solvedRoutes: [{ connection: { connectionId: "net0-original-obligation" },
      path: [{ portId: "original-U1.1" }, { portId: "original-U2.1" }] }],
  } as SerializedHyperGraph
}

function solveSerialized(graph: SerializedHyperGraph): TinyHyperGraphSolver {
  const loaded = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem, {
    MAX_ITERATIONS: 100, STATIC_REACHABILITY_PRECHECK: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  return solver
}

test("legacy and explicit blind/full-stack routing stays exact while split target terminal identity is retained", (): void => {
  for (const [layers, allow] of [
    [[0, 2], undefined], [[0, 2], true], [[2], false], [[0, 1, 2, 3], false],
  ] as Array<[number[], boolean | undefined]>) {
    const graph = terminalTargetGraph(layers)
    const before = JSON.stringify(graph)
    const legacy = solveSerialized(graph)
    const unchanged = splitPartialLayerRegions(graph, { layerCount: 4, allowBlindAndBuriedVias: allow })
    expect(unchanged).toBe(graph)
    expect(JSON.stringify(unchanged)).toBe(before)
    const current = solveSerialized(unchanged)
    expect(current.iterations).toBe(legacy.iterations)
    expect(current.state.regionSegments).toEqual(legacy.state.regionSegments)
    expect(current.getOutput()).toEqual(legacy.getOutput())
  }
  const target = terminalTargetGraph([0, 2])
  const before = JSON.stringify(target)
  const split = splitPartialLayerRegions(target, { layerCount: 4, allowBlindAndBuriedVias: false })
  expect(split).not.toBe(target)
  expect(JSON.stringify(target)).toBe(before)
  expect(split.ports.map(({ portId, d }) => ({ portId, d }))).toEqual(target.ports.map(({ portId, d }) => ({ portId, d })))
  expect(split.connections?.[0]?.startRegionId).toBe("pad-domain::layer:2")
  expect(split.connections?.[0]?.endRegionId).toBe("pad-domain::layer:2")
  expect(split.connections?.[0]?.connectionId).toBe("net0-original-obligation")
  expect(split.solvedRoutes?.[0]?.path).toEqual(target.solvedRoutes?.[0]?.path)
  for (const region of split.regions.filter((row) => row.regionId.startsWith("pad-domain::layer:"))) {
    expect(region.d.netId).toBe(0)
    expect(region.d._containsTarget).toBe(true)
    expect(region.d.capacityMeshNodeId).toBe("pad-domain")
    expect(region.d.custom).toEqual({ preserve: [1, 2] })
  }
  const solved = solveSerialized(split)
  const output = solved.getOutput()
  expect(output.solvedRoutes).toHaveLength(1)
  expect(output.solvedRoutes![0]!.path.map(({ portId }) => portId)).toEqual(["original-U1.1", "original-U2.1"])
  expect(solved.state.regionSegments.flat()).toHaveLength(1)
  const regionIndex = solved.state.regionSegments.findIndex((segments) => segments.length > 0)
  expect(solved.topology.regionAvailableZMask![regionIndex]).toBe(1 << 2)
})
