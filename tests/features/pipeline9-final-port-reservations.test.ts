import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 installs physical owner reservations on the final post-duplicate native model", () => {
  const srj: SimpleRouteJson = {
    layerCount: 8, minTraceWidth: 0.1, minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [{ type: "rect", center: { x: 0.23050071, y: 0.52500044 },
      width: 0.3999992, height: 1.05000044, layers: ["bottom"],
      connectedTo: ["foreign-pad"], circuitJsonMetadata: { pcb_smtpad_id: "foreign-pad" } }],
    connections: [{ name: "route129", __rootConnectionNames: ["root129"],
      pointsToConnect: [{ x: -0.5, y: 0, layer: "bottom", pcb_port_id: "start" },
        { x: 0.8, y: 0, layer: "bottom", pcb_port_id: "end" }] }],
  }
  const pipeline = new Pipeline9(srj)
  pipeline.connMap = new ConnectivityMap({ owner129: ["route129", "root129", "start", "end"],
    owner369: ["foreign-pad"] })
  pipeline.srjWithPointPairs = srj
  pipeline.capacityNodes = [
    { capacityMeshNodeId: "left", center: { x: -0.5, y: 0 }, width: 1, height: 2,
      availableZ: [7], layer: "bottom", _containsTarget: true, _connectedTo: ["root129"] },
    { capacityMeshNodeId: "right", center: { x: 0.5, y: 0 }, width: 1, height: 2,
      availableZ: [7], layer: "bottom", _containsTarget: true, _connectedTo: ["root129"] },
  ]
  pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints = [{
    edgeId: "shared", nodeIds: ["left", "right"], start: { x: 0, y: -1 },
    end: { x: 0, y: 1 }, availableZ: [7], portPoints: [
      { segmentPortPointId: "bad", x: 0, y: 0, availableZ: [7], nodeIds: ["left", "right"],
        edgeId: "shared", connectionName: null, distToCentermostPortOnZ: 0, cramped: false },
      { segmentPortPointId: "safe", x: 0, y: -0.5, availableZ: [7], nodeIds: ["left", "right"],
        edgeId: "shared", connectionName: null, distToCentermostPortOnZ: 0.5, cramped: false },
    ],
  }]
  const step = pipeline.pipelineDef.find((stage) => stage.solverName === "portPointPathingSolver")!
  const [params] = step.getConstructorParams(pipeline) as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>
  expect(params.createPortReservations).toBeFunction()
  const originalBefore = JSON.stringify(pipeline.originalSrj)
  const pathing = new TinyHypergraphPortPointPathingSolver(params)
  const tinyPipeline = (pathing as any).tinyPipelineSolver
  const loaded = tinyPipeline.loadHyperGraph(tinyPipeline.inputProblem.serializedHyperGraph)
  const index = (id: string): number => loaded.topology.portMetadata.findIndex(
    (metadata: { serializedPortId: string }) => metadata.serializedPortId === id,
  )
  expect(loaded.problem.portReservationNetId).toBeInstanceOf(Int32Array)
  expect(loaded.problem.portReservationNetId.length).toBe(loaded.topology.portCount)
  expect(loaded.problem.portReservationNetId[index("bad::7")]).toBe(-2)
  expect(loaded.problem.portReservationNetId[index("safe::7")]).toBe(-1)
  expect(loaded.problem.routeNet[0]).toBe(0)
  expect(loaded.topology.portX[index("bad::7")]).toBe(0)
  expect(loaded.topology.portZ[index("bad::7")]).toBe(7)
  expect([...params.createPortReservations!(loaded)]).toEqual([...loaded.problem.portReservationNetId])
  expect(JSON.stringify(pipeline.originalSrj)).toBe(originalBefore)
  pathing.solve()
  expect(pathing.solved).toBe(true)
  expect(pathing.failed).toBe(false)
  const routedPorts = pathing.getOutput().nodesWithPortPoints.flatMap((node) => node.portPoints)
  expect(routedPorts.some((port) => port.portPointId === "bad::7")).toBe(false)
  expect(routedPorts.some((port) => port.portPointId === "safe::7")).toBe(true)
})
