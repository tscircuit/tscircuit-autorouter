import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("tiny pathing runs congestion search before exposing the final assignments", (): void => {
  const params = structuredClone(input) as unknown as ConstructorParameters<
    typeof TinyHypergraphPortPointPathingSolver
  >[0]
  params.flags.USE_CONGESTION_REROUTING = true
  params.preserveTerminalPcbPortIds = true
  params.connections[0].simpleRouteConnection!.pointsToConnect[0].pcb_port_id =
    "start"
  params.connections[0].simpleRouteConnection!.pointsToConnect[1].pcb_port_id =
    "end"
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.congestionReroutingSolver?.solved).toBe(true)
  expect(solver.stats.currentStage).toBe("congestionRerouting")
  expect(
    solver
      .getOutput()
      .nodesWithPortPoints.flatMap((n) => n.portPoints)
      .filter((p) => p.pcb_port_id)
      .map((p) => p.pcb_port_id)
      .sort(),
  ).toEqual(["end", "start"])
})
