import { expect, spyOn } from "bun:test"
import { LengthMatchingSolver } from "@tscircuit/length-matching-solver"
import {
  getOrderedUsbLaneLengths,
  orderedUsbPair,
  orderedUsbPipelines,
} from "./ordered-usb-pair"

export function checkOrderedUsbPairLanes({
  Pipeline,
}: (typeof orderedUsbPipelines)[number]): void {
  const inputs: unknown[] = []
  const realStep = LengthMatchingSolver.prototype.step
  const observer = spyOn(
    LengthMatchingSolver.prototype,
    "step",
  ).mockImplementation(function (this: LengthMatchingSolver) {
    const pairs = this.getConstructorParams()[0].differentialPairs
    if (pairs?.length && !inputs.includes(pairs)) inputs.push(pairs)
    return realStep.call(this)
  })
  try {
    const solver = new Pipeline(structuredClone(orderedUsbPair), {
      cacheProvider: null,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    const lengths = getOrderedUsbLaneLengths(
      solver._getOutputHdRoutes(),
      solver.netToPointPairsSolver!.newConnections,
    )
    expect(inputs.length).toBeGreaterThan(0)
    for (const pairs of inputs)
      expect(pairs).toEqual([
        {
          connectionNames: lengths.laneNames,
          lengthTolerance:
            orderedUsbPair.differentialPairs![0]!.lengthTolerance,
        },
      ])
    expect(lengths.laneNames.map((lane) => lane.length)).toEqual([2, 2])
  } finally {
    observer.mockRestore()
  }
}
