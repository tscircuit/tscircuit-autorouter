import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphBfsPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphBfsPortPointPathingSolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("tiny hypergraph solvers preserve the original SRJ root connection name", (): void => {
  const params = structuredClone(input) as any
  params.connections[0].mutuallyConnectedNetworkId = "connectivity_net23"
  params.connections[0].simpleRouteConnection.__rootConnectionNames = [
    "source_trace_7",
  ]

  for (const Solver of [
    TinyHypergraphPortPointPathingSolver,
    TinyHypergraphBfsPortPointPathingSolver,
  ]) {
    const solver = new Solver(structuredClone(params))
    solver.solve()

    const portPoints = solver
      .getOutput()
      .nodesWithPortPoints.flatMap((node) => node.portPoints)

    expect(portPoints.length).toBeGreaterThan(0)
    expect(
      portPoints.every(
        (portPoint) => portPoint.rootConnectionName === "source_trace_7",
      ),
    ).toBe(true)
    expect(
      portPoints.some(
        (portPoint) => portPoint.rootConnectionName === "connectivity_net23",
      ),
    ).toBe(false)
  }
})
