import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("TinyHypergraphPortPointPathingSolver does not respect inputSolvedRoutes", () => {
  const solver = new TinyHypergraphPortPointPathingSolver(
    input,
  )

  solver.solve()

  expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(import.meta.path)
})
