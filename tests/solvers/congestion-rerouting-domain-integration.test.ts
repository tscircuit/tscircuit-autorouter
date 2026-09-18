import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("the integrated rerouter receives an explicit global search domain", (): void => {
  const params = structuredClone(input) as unknown as ConstructorParameters<
    typeof TinyHypergraphPortPointPathingSolver
  >[0]
  params.flags.USE_CONGESTION_REROUTING = true
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()
  const reroutingInput =
    solver.congestionReroutingSolver!.getConstructorParams()[0]
  expect(reroutingInput.portSectionMask).toBeDefined()
  expect(reroutingInput.portSectionMask!.length).toBe(
    reroutingInput.solver.topology.portCount,
  )
  expect(
    [...reroutingInput.portSectionMask!].some((value) => value === 1),
  ).toBe(true)
})
