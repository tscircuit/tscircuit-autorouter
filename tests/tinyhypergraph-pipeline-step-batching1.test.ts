import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { getLastStepSvg } from "./fixtures/getLastStepSvg"

type TinyHypergraphParams = ConstructorParameters<
  typeof TinyHypergraphPortPointPathingSolver
>[0]

test("tiny-hypergraph pipeline step batching preserves routed output", async () => {
  const defaultSolver = new TinyHypergraphPortPointPathingSolver(
    structuredClone(input) as TinyHypergraphParams,
  )
  defaultSolver.solve()

  const batchedParams = structuredClone(input) as TinyHypergraphParams
  batchedParams.tinyPipelineStepsPerIteration = 1_000
  const batchedSolver = new TinyHypergraphPortPointPathingSolver(batchedParams)
  batchedSolver.solve()

  expect(batchedSolver.getOutput()).toEqual(defaultSolver.getOutput())
  expect(batchedSolver.iterations).toBeLessThan(defaultSolver.iterations)
  await expect(getLastStepSvg(batchedSolver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
