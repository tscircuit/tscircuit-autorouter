import { expect, test } from "bun:test"
import { getFixedCopperPortalSites } from "lib/solvers/UniformPortDistributionSolver/getFixedCopperPortalSites"
import { placeOrderedPortsInClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/placeOrderedPortsInClearanceIntervals"

test("portal spacing and existing ordered placement retain directed decimal bounds", (): void => {
  for (const edge of [
    { start: 0.7, end: 0.8, expected: [0.7, 0.8] },
    { start: -0.8, end: -0.7, expected: [-0.8, -0.7] },
    { start: 0, end: 0.3, expected: [0, 0.1, 0.2] },
    {
      start: 0,
      end: 0.30000000000000004,
      expected: [0, 0.1, 0.2, 0.30000000000000004],
    },
  ]) {
    const result = getFixedCopperPortalSites({
      start: { x: edge.start, y: 0 },
      end: { x: edge.end, y: 0 },
      layerCount: 1,
      zLayers: [0],
      traceWidth: 0.1,
      traceGap: 0,
      padGap: 0,
      routableNetIds: new Set(["route-net"]),
      rectangles: [],
    })
    expect(result.layers[0]!.intervals).toEqual([
      { start: edge.start, end: edge.end },
    ])
    expect(result.layers[0]!.sites.map((site): number => site.x)).toEqual(
      edge.expected,
    )
    for (let index = 1; index < result.layers[0]!.sites.length; index++) {
      expect(
        result.layers[0]!.sites[index]!.x -
          result.layers[0]!.sites[index - 1]!.x,
      ).toBeGreaterThanOrEqual(0.1)
    }
  }
  const existingPlacement = placeOrderedPortsInClearanceIntervals({
    ports: [
      {
        allowedIntervals: [{ start: 0.7, end: 0.7 }],
        uniformTarget: 0.7,
        canonicalNetId: "first-net",
        copperDiameter: 0.1,
      },
      {
        allowedIntervals: [{ start: 0.7, end: 1 }],
        uniformTarget: 0.7,
        canonicalNetId: "second-net",
        copperDiameter: 0.1,
      },
    ],
    traceGap: 0,
  })
  expect(existingPlacement).toEqual([0.7, 0.8])
  expect(existingPlacement[1]! - existingPlacement[0]!).toBeGreaterThanOrEqual(
    0.1,
  )
})
