import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("TinyHypergraphPortPointPathingSolver does not respect inputSolvedRoutes", () => {
  const solver = new TinyHypergraphPortPointPathingSolver(input as any)
  const serializedSolvedRoutes = (solver as any).tinyPipelineSolver.inputProblem
    .serializedHyperGraph.solvedRoutes

  // expect(serializedSolvedRoutes).toEqual([
  //   {
  //     connection: {
  //       connectionId: "bridge-repro",
  //     },
  //     path: [
  //       { portId: "p0" },
  //       { portId: "p1" },
  //       { portId: "p2" },
  //       { portId: "p3" },
  //       { portId: "p4" },
  //       { portId: "p5" },
  //     ],
  //   },
  // ])

  solver.solve()

  expect(serializedSolvedRoutes).toEqual([
    {
      connection: {
        connectionId: "bridge-repro",
      },
      path: [
        { portId: "tiny-terminal:start-port:bridge-repro" },
        { portId: "tiny-terminal:end-port:bridge-repro" },
      ],
    },
  ])
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const output = solver.getOutput()
  expect(
    output.nodesWithPortPoints.map((node) => node.capacityMeshNodeId),
  ).toEqual(["bl", "left-bridge", "br"])
  expect(
    output.nodesWithPortPoints.map((node) => [
      node.capacityMeshNodeId,
      node.portPoints.map((point) => point.portPointId),
    ]),
  ).toEqual([
    ["bl", ["tiny-terminal:start-port:bridge-repro", "p0"]],
    ["left-bridge", ["p0", "p5"]],
    ["br", ["p5", "tiny-terminal:end-port:bridge-repro"]],
  ])
})
