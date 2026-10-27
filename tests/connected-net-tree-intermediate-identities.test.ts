import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

type TinyParams = ConstructorParameters<
  typeof TinyHypergraphPortPointPathingSolver
>[0]

test("intermediate shared-port identities never become this demand's endpoints even after metadata replay", () => {
  const params = structuredClone(input) as TinyParams
  params.preserveTerminalPcbPortIds = true
  params.flags.USE_DYNAMIC_CONNECTED_NET_TREES = true
  const connection = params.connections[0]!.simpleRouteConnection!
  connection.pointsToConnect[0]!.pcb_port_id = "pcb_port_start"
  connection.pointsToConnect[1]!.pcb_port_id = "pcb_port_end"
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  const pipeline: { getSolvedTinySolver(): TinyHyperGraphSolver } =
    Reflect.get(solver, "tinyPipelineSolver")
  const native = pipeline.getSolvedTinySolver()
  const interior = native.state.regionSegments
    .flat()
    .flatMap(([, fromPortId, toPortId]) => [fromPortId, toPortId])
    .find(
      (portId) =>
        portId !== native.problem.routeStartPort[0] &&
        portId !== native.problem.routeEndPort[0],
    )
  if (interior === undefined) throw new Error("Fixture has no interior port")
  const metadata: Record<string, unknown> =
    native.topology.portMetadata![interior]!
  delete metadata._tinyTerminal
  for (const pcbPortId of ["pcb_port_793", "pcb_port_start"]) {
    metadata.pcb_port_id = pcbPortId
    const tagged = solver
      .getOutput()
      .nodesWithPortPoints.flatMap((node) => node.portPoints)
      .filter((point) => point.pcb_port_id)
      .map((point) => point.pcb_port_id)
      .sort()
    expect(tagged).toEqual(["pcb_port_end", "pcb_port_start"])
  }
})
