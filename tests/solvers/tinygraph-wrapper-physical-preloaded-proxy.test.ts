import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createPhysicalWrapperProblem } from "../fixtures/tinygraph/createPhysicalWrapperProblem"

test("physical wrapper context does not reject unchanged preload copper by its proxy portal", (): void => {
  const params = createPhysicalWrapperProblem(true)
  const solver = new TinyHypergraphPortPointPathingSolver({
    ...params,
    physicalClearance: {
      clearanceIndex: new FixedCopperClearanceIndex({
        rectangles: [
          {
            kind: "fixed-rectangle",
            center: { x: -1, y: 0 },
            width: 0.2,
            height: 0.2,
            zLayers: [0],
            ownerNetIds: new Set(["foreign-pad-net"]),
          },
        ],
        layerCount: 1,
        minClearance: 0.05,
      }),
      traceWidth: 0.1,
    },
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.preloadedFixedSegmentCount).toBe(1)
  expect(solver.getOutput().changedPreloadedTraceSections).toEqual([])
  expect(solver.getOutput().nodesWithPortPoints).toEqual([])
})
