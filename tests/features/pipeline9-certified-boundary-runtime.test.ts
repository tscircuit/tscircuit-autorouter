import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { constructPipeline9ParametricCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import { createBoundaryInterfaceIndex, getBoundaryInterfaceKey, getBoundaryInterfaceSceneKey, getBoundaryPhysicalRulesKey, getBoundaryFixedCopperKey, normalizeBoundaryNodeRoots, type BoundaryRouteCertificates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/boundaryRouteCertificates"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("certificate geometry and native iteration accounting survive the one-worker runtime boundary", async (): Promise<void> => {
  const connMap = new ConnectivityMap({})
  const rules = { obstacles: [], layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.15 }
  const nodes = Array.from({ length: 13 }, (_, index) => ({ capacityMeshNodeId: `cell${index}`, center: { x: index * 4, y: 0 }, width: 3, height: 3, availableZ: [0],
    portPoints: [{ connectionName: `signal${index}`, x: index * 4 - 1, y: -0.5, z: 0 }, { connectionName: `signal${index}`, x: index * 4 + 1, y: 0.5, z: 0 }] }))
  connMap.addConnections(nodes.map((_, index) => [`signal${index}`, `pad${index}`]))
  const reservations = createBoundaryInterfaceIndex(nodes, rules, connMap).ports
  const certificates: BoundaryRouteCertificates = { context: { rulesKey: getBoundaryPhysicalRulesKey(rules), fixedCopperKey: getBoundaryFixedCopperKey([]), interfaceSceneKey: getBoundaryInterfaceSceneKey(reservations) }, cells: {} }
  for (const node of nodes) {
    const construction = constructPipeline9ParametricCell({ ...rules, node: normalizeBoundaryNodeRoots(node, connMap), connMap,
      interfacePolicy: "owned-normal-escapes", interfacePortPoints: reservations })
    expect(construction.applicable).toBe(true)
    certificates.cells[node.capacityMeshNodeId] = { interfaceKey: getBoundaryInterfaceKey(node, connMap), routeKey: JSON.stringify(construction.routes), routes: construction.routes }
  }
  const params = { ...rules, connMap, fixedHdRoutes: [], nodePortPoints: nodes, effort: 1, boundaryCertificates: certificates }
  const serial = new Pipeline9HighDensitySolver(params)
  serial.solve()
  expect(serial.stats.boundaryCertificateSkippedSearches).toBe(13)
  const runtime = createPipeline9TestRuntime(1)
  try {
    for (const limit of [1, 7, Infinity]) {
      const expected = new Pipeline9HighDensitySolver(params)
      const actual = new Pipeline9HighDensitySolver(params)
      while (!expected.solved && expected.iterations < limit) expected.step()
      await actual.solveAsync(runtime, limit)
      expect(actual.routes).toEqual(expected.routes)
      expect(actual.stats).toEqual(expected.stats)
      expect(actual.iterations).toBe(expected.iterations)
      expect(actual.solved).toBe(expected.solved)
    }
  } finally {
    await runtime.dispose()
  }
})
