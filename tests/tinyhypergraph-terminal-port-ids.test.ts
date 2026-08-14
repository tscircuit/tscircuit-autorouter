import { expect, test } from "bun:test"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"

test("TinyHypergraph port-point pathing assigns PCB terminal identities", () => {
  const params = structuredClone(input) as any
  params.preserveTerminalPcbPortIds = true
  const [connection] = params.connections
  connection.simpleRouteConnection.pointsToConnect[0].pcb_port_id =
    "pcb_port_start"
  connection.simpleRouteConnection.pointsToConnect[1].pcb_port_id =
    "pcb_port_end"

  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()

  const terminalPortPoints = solver
    .getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPoints)
    .filter((portPoint) => portPoint.pcb_port_id)
    .map(({ x, y, pcb_port_id }) => ({ x, y, pcb_port_id }))
    .sort((a, b) => a.x - b.x)

  expect(terminalPortPoints).toEqual([
    { x: -4, y: -3, pcb_port_id: "pcb_port_start" },
    { x: 4, y: -3, pcb_port_id: "pcb_port_end" },
  ])
  expect(solver.getSolveGraphBenchmarkMetrics()?.optimizer).toMatchObject({
    regionCostModel: "routing-complexity",
    acceptedMutationCount: 0,
    optimizationStopReason: "local_optimum",
  })

  const output = solver.getOutput()
  const solvedNodeIds = new Set(
    output.nodesWithPortPoints.map((node) => node.capacityMeshNodeId),
  )
  const solvedInputNode = output.inputNodeWithPortPoints.find((node) =>
    solvedNodeIds.has(node.capacityMeshNodeId),
  )!
  const nodePf = solver.computeNodePf(solvedInputNode)
  expect(nodePf).not.toBeNull()

  solver.getOutput = () => {
    throw new Error("computeNodePf rematerialized the solved output")
  }
  expect(solver.computeNodePf(solvedInputNode)).toBe(nodePf)
})
