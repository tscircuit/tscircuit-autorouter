import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"

test("P9 preserves separate planar domains in solved output and Uniform incidence with exact physical bounds", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 3, minTraceWidth: .1, minViaDiameter: .3, allowBlindAndBuriedVias: false,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 }, obstacles: [],
    connections: [
      { name: "routeA", __rootConnectionNames: ["rootA"], pointsToConnect: [
        { x: -2, y: -.5, layer: "inner1", pcb_port_id: "pcb-A-left" },
        { x: 2, y: -.5, layer: "inner1", pcb_port_id: "pcb-A-right" }] },
      { name: "routeB", __rootConnectionNames: ["rootB"], pointsToConnect: [
        { x: -2, y: .5, layer: "bottom", pcb_port_id: "pcb-B-left" },
        { x: 2, y: .5, layer: "bottom", pcb_port_id: "pcb-B-right" }] },
    ],
  }
  const pipeline = new Pipeline9(srj)
  pipeline.srjWithPointPairs = srj
  pipeline.connMap = new ConnectivityMap({
    ownerA: ["routeA", "rootA", "pcb-A-left", "pcb-A-right"],
    ownerB: ["routeB", "rootB", "pcb-B-left", "pcb-B-right"],
  })
  pipeline.capacityNodes = [
    { capacityMeshNodeId: "central", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [1, 2], layer: "inner1" },
    ...["left", "right"].flatMap((side) => [1, 2].map((z) => ({
      capacityMeshNodeId: `${side}-${z}`, center: { x: side === "left" ? -2 : 2, y: z === 1 ? -.5 : .5 },
      width: 2, height: 1, availableZ: [z], layer: z === 1 ? "inner1" : "bottom", _containsTarget: true,
      _connectedTo: [z === 1 ? "rootA" : "rootB"],
    }))),
  ]
  pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints = ["left", "right"].flatMap((side) =>
    [1, 2].map((z) => ({
      edgeId: `${side}-edge-${z}`, nodeIds: ["central", `${side}-${z}`] as [string, string],
      start: { x: side === "left" ? -1 : 1, y: z === 1 ? -1 : 0 },
      end: { x: side === "left" ? -1 : 1, y: z === 1 ? 0 : 1 }, availableZ: [z],
      portPoints: [{ segmentPortPointId: `${side}-port-${z}`, x: side === "left" ? -1 : 1,
        y: z === 1 ? -.5 : .5, availableZ: [z], nodeIds: ["central", `${side}-${z}`] as [string, string],
        edgeId: `${side}-edge-${z}`, connectionName: null, distToCentermostPortOnZ: 0, cramped: false }],
    })),
  )
  const before = JSON.stringify({ srj, nodes: pipeline.capacityNodes,
    edges: pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints })
  const step = pipeline.pipelineDef.find((stage) => stage.solverName === "portPointPathingSolver")!
  const [params] = step.getConstructorParams(pipeline) as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>
  expect(params.allowBlindAndBuriedVias).toBe(false)
  const pathing = new TinyHypergraphPortPointPathingSolver(params)
  pathing.solve()
  expect(pathing.solved).toBe(true)
  expect(pathing.failed).toBe(false)
  const output = pathing.getOutput()
  expect(new Set(output.nodesWithPortPoints.map((node) => node.capacityMeshNodeId)).size).toBe(output.nodesWithPortPoints.length)
  const center = output.nodesWithPortPoints.filter((node) => node.capacityMeshNodeId.startsWith("central"))
  expect(center.map((node) => node.capacityMeshNodeId).sort()).toEqual(["central::layer:1", "central::layer:2"])
  const expected = new Map<string, { x: number; y: number; z: number }>([1, 2].flatMap((z) => ["left", "right"].map((side) => [
    `${side}-port-${z}::${z}`, { x: side === "left" ? -1 : 1, y: z === 1 ? -.5 : .5, z },
  ] as const)))
  for (const domain of center) {
    const z = Number(domain.capacityMeshNodeId.at(-1))
    expect(domain.availableZ).toEqual([z])
    expect(domain.center).toEqual({ x: 0, y: 0 })
    expect(domain.width).toBe(2)
    expect(domain.height).toBe(2)
    expect(domain.portPointsInPairs).toHaveLength(1)
    expect(domain.portPoints).toHaveLength(2)
    for (const point of domain.portPoints) {
      expect(point.z).toBe(z)
      expect({ x: point.x, y: point.y, z: point.z }).toEqual(expected.get(point.portPointId!)!)
    }
  }
  const inputCenter = output.inputNodeWithPortPoints.filter((node) => node.capacityMeshNodeId.startsWith("central"))
  expect(inputCenter.map((node) => node.capacityMeshNodeId).sort()).toEqual(["central::layer:1", "central::layer:2"])
  for (const input of inputCenter) for (const point of input.portPoints) {
    expect(point.connectionNodeIds).toContain(input.capacityMeshNodeId)
    expect(point.connectionNodeIds).not.toContain("central")
    expect({ x: point.x, y: point.y, z: point.z }).toEqual(expected.get(point.portPointId!)!)
  }
  const terminals = output.nodesWithPortPoints.flatMap((node) => node.portPoints).filter((point) => point.pcb_port_id)
  expect(new Set(terminals.map((point) => point.pcb_port_id))).toEqual(new Set([
    "pcb-A-left", "pcb-A-right", "pcb-B-left", "pcb-B-right",
  ]))
  expect(JSON.stringify({ srj, nodes: pipeline.capacityNodes,
    edges: pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints })).toBe(before)
})
