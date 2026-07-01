import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { HyperTinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/HyperTinyHypergraphPortPointPathingSolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("HyperTinyHypergraphPortPointPathingSolver solves a tiny graph variant", () => {
  const solver = new HyperTinyHypergraphPortPointPathingSolver({
    variants: [
      {
        name: "bridge-repro",
        tinyParams: input as any,
      },
    ],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.stats.winningTinyHypergraphVariant).toBe("bridge-repro")
  expect(solver.getOutput().nodesWithPortPoints.length).toBeGreaterThan(0)
})

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
