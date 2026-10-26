import { expect, test } from "bun:test"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type PortPathingParams = ConstructorParameters<
  typeof TinyHypergraphPortPointPathingSolver
>[0]

test("exact region-cost pathing preserves bridge terminals", (): void => {
  const params = structuredClone(input) as PortPathingParams
  params.preserveTerminalPcbPortIds = true
  const connection = params.connections[0]
  const routeConnection = connection.simpleRouteConnection
  if (!routeConnection) {
    throw new Error("Bridge fixture is missing its declared route connection")
  }
  routeConnection.pointsToConnect[0].pcb_port_id = "lookup_start"
  routeConnection.pointsToConnect[1].pcb_port_id = "lookup_end"
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const solveGraph =
    solver["tinyPipelineSolver"].getSolver<TinyHyperGraphSolver>("solveGraph")
  expect(solveGraph?.USE_REGION_COST_LOOKUP).toBe(true)
  const terminals = solver
    .getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPoints)
    .filter((point) => point.pcb_port_id)
    .map(({ x, y, pcb_port_id }) => ({ x, y, pcb_port_id }))
    .sort((left, right) => left.x - right.x)
  expect(terminals).toEqual([
    { x: -4, y: -3, pcb_port_id: "lookup_start" },
    { x: 4, y: -3, pcb_port_id: "lookup_end" },
  ])
})
