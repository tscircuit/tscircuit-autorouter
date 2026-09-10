import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import {
  initTinyHypergraphWasm,
  loadSerializedHyperGraph,
  TinyHyperGraphSolver,
} from "@tscircuit/tiny-hypergraph-wasm"

test("serialized graphs load, route, and retain existing assignments through WASM", async () => {
  await initTinyHypergraphWasm(await readFile(new URL(
    import.meta.resolve("@tscircuit/tiny-hypergraph-wasm/wasm"),
  )))
  const connection = {
    connectionId: "route-0",
    mutuallyConnectedNetworkId: "net-0",
    startRegionId: "start",
    endRegionId: "end",
    preloadedTraceSection: { originalConnectionName: "existing-trace" },
  }
  const graph = {
    regions: [
      { regionId: "start", pointIds: ["p0"], d: {
        center: { x: -2, y: 0 }, width: 2, height: 2, availableZ: [0],
      } },
      { regionId: "middle", pointIds: ["p0", "p1"], d: {
        center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0],
        _tinyTerminalNetId: "net-0",
      } },
      { regionId: "end", pointIds: ["p1"], d: {
        center: { x: 2, y: 0 }, width: 2, height: 2, availableZ: [0],
      } },
      { regionId: "obstacle", pointIds: [], d: { _containsObstacle: true } },
    ],
    ports: [
      { portId: "p0", region1Id: "middle", region2Id: "start", d: {
        x: -1, y: 0, z: 0, tinyHypergraphPortPenalty: 0.25,
        customMetadata: { name: "retained" },
      } },
      { portId: "p1", region1Id: "middle", region2Id: "end", d: { x: 1, y: 0, z: 0 } },
    ],
    connections: [connection],
  }
  const original = structuredClone(graph)
  const loaded = loadSerializedHyperGraph(graph)
  assert.deepEqual(graph, original)
  assert.equal(loaded.topology.regionCount, 3)
  assert.deepEqual(loaded.topology.regionIncidentPorts, [[0], [0, 1], [1]])
  assert.deepEqual(loaded.topology.portX, [-1, 1])
  assert.deepEqual(loaded.problem.routeStartPort, [0])
  assert.deepEqual(loaded.problem.routeEndPort, [1])
  assert.deepEqual(loaded.problem.routeNet, [0])
  assert.deepEqual(loaded.problem.regionNetId, [0, -1, 0])
  assert.deepEqual(loaded.problem.portPenalty, [0.25, 0])
  assert.deepEqual(loaded.problem.routeMetadata, [connection])
  assert.deepEqual(loaded.solution.solvedRoutePathSegments, [[]])
  assert.equal(loaded.topology.regionMetadata[1]._tinyTerminalNetId, "net-0")
  assert.equal(loaded.topology.portMetadata[0].serializedPortId, "p0")

  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem, { MAX_ITERATIONS: 100 })
  let output
  try {
    assert.equal(solver.solve().solved, true)
    assert.deepEqual(solver.getRoutingSnapshot().regionSegments, [[], [[0, 0, 1]], []])
    output = solver.getOutput()
    assert.deepEqual(output.solvedRoutes[0].path.map((step) => step.portId), ["p0", "p1"])
    assert.deepEqual(output.ports[0].d.customMetadata, { name: "retained" })
  } finally {
    solver.dispose()
  }

  const preloadedGraph = structuredClone(original)
  preloadedGraph.solvedRoutes = output.solvedRoutes
  preloadedGraph.regions[1].assignments = [{
    connectionId: "route-0", regionPort1Id: "p0", regionPort2Id: "p1",
  }]
  const preloaded = loadSerializedHyperGraph(preloadedGraph)
  assert.deepEqual(preloaded.problem.initialAssignments, [{
    routeId: 0, regionId: 1, fromPortId: 0, toPortId: 1,
  }])
  assert.deepEqual(preloaded.solution.solvedRoutePathSegments, [[[0, 1]]])
  assert.deepEqual(preloaded.solution.solvedRoutePathRegionIds, [[1]])
  const resumed = new TinyHyperGraphSolver(preloaded.topology, preloaded.problem)
  try {
    assert.equal(resumed.solve().solved, true)
    assert.deepEqual(resumed.getRoutingSnapshot().regionSegments, [[], [[0, 0, 1]], []])
  } finally {
    resumed.dispose()
  }
})
