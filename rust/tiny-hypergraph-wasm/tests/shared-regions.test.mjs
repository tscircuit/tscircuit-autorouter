import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { initTinyHypergraphWasm, loadSerializedHyperGraph } from "@tscircuit/tiny-hypergraph-wasm"
import { createCrossingGraph } from "./createCrossingGraph.mjs"

test("shared-region filtering handles reversed endpoints and retains multi-port solved routes", async () => {
  await initTinyHypergraphWasm(await readFile(new URL(
    import.meta.resolve("@tscircuit/tiny-hypergraph-wasm/wasm"),
  )))
  const graph = createCrossingGraph()
  const connection = {
    connectionId: "retained", startRegionId: "west", endRegionId: "middle",
  }
  graph.connections.splice(1, 0,
    { connectionId: "direct", startRegionId: "west", endRegionId: "middle" },
    { connectionId: "reversed", startRegionId: "middle", endRegionId: "west" },
    { connectionId: "single-port", startRegionId: "west", endRegionId: "middle" },
    connection,
  )
  graph.solvedRoutes = [
    { connection: graph.connections[3], path: [{ portId: "p0" }] },
    { connection, path: [
      { portId: "p0", nextRegionId: "middle" },
      { portId: "p1", lastRegionId: "middle" },
    ] },
  ]
  const { problem, solution } = loadSerializedHyperGraph(graph)
  assert.equal(problem.routeCount, 3)
  assert.deepEqual(problem.routeMetadata.map((route) => route.connectionId), [
    "horizontal", "retained", "vertical",
  ])
  assert.deepEqual(solution.solvedRoutePathSegments, [[], [[0, 1]], []])
  assert.deepEqual(solution.solvedRoutePathRegionIds, [[], [4], []])
})
