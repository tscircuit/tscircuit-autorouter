import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("port-point racing obeys a finite step budget and resumes to the synchronous result", async (): Promise<void> => {
  type Params = ConstructorParameters<
    typeof TinyHypergraphPortPointPathingSolver
  >[0]
  const serial = new TinyHypergraphPortPointPathingSolver(
    structuredClone(input) as Params,
  )
  serial.solve()
  const resumed = new TinyHypergraphPortPointPathingSolver(
    structuredClone(input) as Params,
  )
  await resumed.solveAsync(undefined, 3)
  expect(resumed.iterations).toBe(3)
  expect(resumed.solved).toBe(false)
  expect(resumed.failed).toBe(false)
  await resumed.solveAsync()
  expect(resumed.solved).toBe(true)
  expect(resumed.iterations).toBe(serial.iterations)
  expect(resumed.getOutput()).toEqual(serial.getOutput())
})
