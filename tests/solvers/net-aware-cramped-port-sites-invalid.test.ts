import { expect, test } from "bun:test"
import {
  type NetAwareCrampedPortSitesInput,
  getNetAwareCrampedPortSites,
} from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"
import { createNetAwareCrampedCorridor } from "../fixtures/netAwareCrampedPortSites"

test("invalid physical inputs and an already usable site cannot enter blocked-edge packing", (): void => {
  const input = createNetAwareCrampedCorridor()
  const invalid: Partial<NetAwareCrampedPortSitesInput>[] = [
    { traceWidth: 0 },
    { traceWidth: Number.MIN_VALUE },
    { traceWidth: Number.POSITIVE_INFINITY },
    { traceGap: -1 },
    { padGap: Number.NaN },
    { routableNetIds: new Set() },
    { routableNetIds: new Set([""]) },
    { layerCount: 0 },
    { existingPoint: { x: 0.25, y: 0.5, z: 2 } },
    { existingPoint: { x: 0, y: 0.5, z: 0 } },
    { existingPoint: { x: 0.25, y: 1, z: 0 } },
    { start: { x: Number.NaN, y: 0.25 } },
    { end: { x: 0.5, y: 0.75 } },
    { end: input.start },
  ]
  for (const variant of invalid) {
    expect((): unknown =>
      getNetAwareCrampedPortSites({ ...input, ...variant }),
    ).toThrow()
  }
  expect((): unknown =>
    getNetAwareCrampedPortSites({
      ...input,
      existingPoint: { x: 0.25, y: 0.25, z: 0 },
    }),
  ).toThrow("all-net-blocked existing site")
  expect((): unknown =>
    getNetAwareCrampedPortSites({
      ...input,
      rectangles: [
        ...input.rectangles,
        {
          kind: "fixed-rectangle",
          center: { x: 1000, y: 1000 },
          width: -1,
          height: 1,
          zLayers: [1],
          ownerNetIds: new Set(["route-net"]),
        },
      ],
    }),
  ).toThrow()
})
