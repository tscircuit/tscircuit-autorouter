import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineSolver9_Networked } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/AutoroutingPipelineSolver9_Networked"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createPipeline9CellInterfaceSupport } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9CellInterfaceSupport"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("default Pipeline9 factories and every runtime batch require the owned-support policy with exact serial parity", async (): Promise<void> => {
  const scene: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.15, obstacles: [], bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, connections: [{ name: "signal", pointsToConnect: [{ x: -1, y: -0.5, layer: "top" }, { x: 1, y: 0.5, layer: "top" }] }] }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scene), { cacheProvider: null })
  pipeline.solveUntilPhase("highDensityStitchSolver")
  const networked = new AutoroutingPipelineSolver9_Networked(structuredClone(scene), { cacheProvider: null })
  for (const source of [pipeline, networked]) {
    const factory = source.pipelineDef.find((step) => step.solverName === "highDensityRouteSolver")!
    // Exercise the networked factory's inherited physical parameters without
    // making remote cache requests as part of this local correctness test.
    const [derived] = factory.getConstructorParams(pipeline) as [Pipeline9HighDensitySolverParams]
    expect(derived.enableParametricConstruction).toBe(true)
    const hd = new Pipeline9HighDensitySolver(derived)
    hd.solve()
    expect(pipeline.failed).toBe(false)
    expect(hd.solved).toBe(true)
    expect(hd.stats.parametricInterfacePolicyNodeCount).toBe(hd.stats.regularNodeCount + hd.stats.parametricCompiledNodeCount)
    expect(hd.stats.parametricInterfaceCertifiedRoutes).toBeGreaterThan(0)
  }
  const nodes: NodeWithPortPoints[] = Array.from({ length: 13 }, (_, i) => ({ capacityMeshNodeId: `owned${i}`, center: { x: i * 3.2, y: 0 }, width: 3, height: 3, availableZ: [0], portPoints: [
    { connectionName: `signal${i}`, portPointId: `left${i}`, x: i * 3.2 - 1.5, y: -0.5, z: 0 },
    { connectionName: `signal${i}`, portPointId: `right${i}`, x: i * 3.2 + 1.5, y: 0.5, z: 0 },
  ] }))
  const params = { nodePortPoints: nodes, enableParametricConstruction: true, connMap: new ConnectivityMap({}), obstacles: [], fixedHdRoutes: [], layerCount: 2, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1 }
  const serial = new Pipeline9HighDensitySolver(params)
  serial.solve()
  expect(serial.solved).toBe(true)
  expect(serial.stats.parametricInterfacePolicyNodeCount).toBe(nodes.length)
  expect(serial.stats.parametricInterfaceCertifiedRoutes).toBe(nodes.length)
  expect(serial.stats.parametricInterfaceTerminalEscapes).toBe(nodes.length * 2)
  expect(serial.stats.parametricInterfaceReservationRowsRetained).toBeGreaterThan(nodes.length * 2)
  for (const workerCount of [1, 4]) {
    const runtime = createPipeline9TestRuntime(workerCount)
    const batched = new Pipeline9HighDensitySolver(params)
    try { await batched.solveAsync(runtime) } finally { await runtime.dispose() }
    expect(batched.solved).toBe(true)
    expect(batched.routes).toEqual(serial.routes)
    expect(batched.stats).toEqual(serial.stats)
    expect(batched.iterations).toBe(serial.iterations)
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const support = createPipeline9CellInterfaceSupport({ node, pair: [node.portPoints[0]!, node.portPoints[1]!], traceWidth: params.traceWidth, viaDiameter: params.viaDiameter, clearance: params.obstacleMargin, layerCount: params.layerCount, interfacePortPoints: nodes.flatMap((owner) => owner.portPoints.map((port) => ({ capacityMeshNodeId: owner.capacityMeshNodeId, port, traceWidth: params.traceWidth }))) })!
      expect(support.certify(batched.routes.find((route) => route.connectionName === node.portPoints[0]!.connectionName)!)).toBe(true)
    }
  }
})
