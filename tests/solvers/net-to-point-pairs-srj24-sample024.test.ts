import { expect, test } from "bun:test"
import sample024 from "@tscircuit/dataset-srj24/samples/sample024.json"
import { PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver"
import { DisjointSet } from "../../lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { NetToPointPairsSolver } from "../../lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "../../lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "../../lib/utils/get-initially-connected-map-from-simple-route-json"

test("SRJ24 sample024 retains every terminal and net", (): void => {
  const input = structuredClone(sample024) as SimpleRouteJson
  const original = structuredClone(input)
  const preprocess = new PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver(
    input,
  )
  preprocess.solve()
  const preprocessed = preprocess.getOutputSimpleRouteJson()
  expect(preprocess.solved).toBe(true)
  expect(preprocessed.connections).toEqual(original.connections)
  const solver = new NetToPointPairsSolver(
    preprocessed,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(preprocessed),
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.newConnections).toHaveLength(1934)
  expect(input).toEqual(original)
  for (const connection of input.connections) {
    const points = connection.pointsToConnect
    const connected = new DisjointSet(points)
    for (const pair of solver.newConnections) {
      if (!pair.__rootConnectionNames?.includes(connection.name)) continue
      connected.union(pair.pointsToConnect[0]!, pair.pointsToConnect[1]!)
    }
    expect(new Set(points.map((point) => connected.find(point))).size).toBe(1)
  }
})
