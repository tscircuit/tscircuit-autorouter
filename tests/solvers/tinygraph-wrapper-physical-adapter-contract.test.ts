import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createPhysicalWrapperProblem } from "../fixtures/tinygraph/createPhysicalWrapperProblem"

test("physical wrapper inputs do not silently switch or bypass the selected native algorithm", (): void => {
  const params = createPhysicalWrapperProblem()
  params.flags.USE_SELECTIVE_RERIP_ROUTING = false
  expect((): void => {
    new TinyHypergraphPortPointPathingSolver({
      ...params,
      physicalClearance: {
        clearanceIndex: new FixedCopperClearanceIndex({
          rectangles: [],
          layerCount: 1,
          minClearance: 0.05,
        }),
        traceWidth: 0.1,
      },
    })
  }).toThrow("requires the existing selective-rerip adapter")
  const legacy = new TinyHypergraphPortPointPathingSolver(params)
  legacy.solve()
  expect(legacy.failed).toBeFalse()
  expect(legacy.solved).toBeTrue()
})
