import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type TinyHypergraphParams = ConstructorParameters<
  typeof TinyHypergraphPortPointPathingSolver
>[0]

test("tiny-hypergraph pipeline step batching rejects invalid sizes", () => {
  for (const invalidSize of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    const params = structuredClone(input) as TinyHypergraphParams
    params.tinyPipelineStepsPerIteration = invalidSize
    expect(() => new TinyHypergraphPortPointPathingSolver(params)).toThrow(
      "tinyPipelineStepsPerIteration must be a finite positive integer",
    )
  }
})
