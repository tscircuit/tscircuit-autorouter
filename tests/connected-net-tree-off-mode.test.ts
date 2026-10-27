import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import baseline from "./fixtures/connected-net-tree-off-mode-baseline.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type TinyParams = ConstructorParameters<
  typeof TinyHypergraphPortPointPathingSolver
>[0]

test("generic Tiny callers preserve the original shared-terminal graph and routes when the experiment is omitted or false", () => {
  // Reference captured from main fb6c0f5 with its original a1d4d22 Tiny pin.
  for (const enabled of [undefined, false]) {
    const params = structuredClone(input) as TinyParams
    params.preserveTerminalPcbPortIds = true
    params.flags.USE_DYNAMIC_CONNECTED_NET_TREES = enabled
    const first = params.connections[0]!
    const connection = first.simpleRouteConnection!
    connection.pointsToConnect[0]!.pcb_port_id = "pcb_port_start"
    connection.pointsToConnect[1]!.pcb_port_id = "pcb_port_end"
    const second = structuredClone(first)
    second.connectionId += "_shared"
    second.simpleRouteConnection!.name += "_shared"
    params.connections.push(second)
    const solver = new TinyHypergraphPortPointPathingSolver(params)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.getOutput()).toEqual(baseline.output)
    expect(
      "connectedTreeRouteAttempts" in solver.getSolveGraphBenchmarkMetrics()!,
    ).toBe(false)
  }
})
