import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import {
  TinyHypergraphPortPointPathingSolver,
  type TinyHypergraphPhysicalClearanceInput,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createPhysicalWrapperProblem } from "../fixtures/tinygraph/createPhysicalWrapperProblem"

test("the wrapper searches legal physical portals without changing obstacle-free routing", (): void => {
  for (const withPhysicalClearance of [false, true]) {
    const params = createPhysicalWrapperProblem()
    const physicalClearance: TinyHypergraphPhysicalClearanceInput = {
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
    }
    const solver = new TinyHypergraphPortPointPathingSolver({
      ...params,
      physicalClearance: withPhysicalClearance ? physicalClearance : undefined,
    })
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    const output = solver.getOutput()
    const westPortPoints = output.nodesWithPortPoints
      .flatMap((node): typeof node.portPoints => node.portPoints)
      .filter((point): boolean => point.x === -1)
    expect(westPortPoints).toHaveLength(2)
    expect(westPortPoints.map((point): number => point.y)).toEqual(
      withPhysicalClearance ? [0.6, 0.6] : [0, 0],
    )
    expect(output.changedPreloadedTraceSections).toEqual([])
    expect(solver.stats.sectionMaskPortCount).toBe(0)
  }
})
