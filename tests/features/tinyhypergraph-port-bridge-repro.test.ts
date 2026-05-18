import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
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

  expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
