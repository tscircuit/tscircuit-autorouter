import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import { getNetAwareCrampedPortSites } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"
import { createNetAwareCrampedCorridor } from "../fixtures/netAwareCrampedPortSites"

test("nearby ownership classes retain actual masks and ignore irrelevant owner distinctions", (): void => {
  const input = createNetAwareCrampedCorridor()
  const rectangles: FixedCopperRectangle[] = input.rectangles.map(
    (rectangle): FixedCopperRectangle => ({
      ...rectangle,
      ownerNetIds: rectangle.ownerNetIds.has("route-net")
        ? new Set(["route-net", "shared-owner", "not-routed"])
        : new Set(rectangle.ownerNetIds),
    }),
  )
  rectangles.push(
    {
      kind: "fixed-rectangle",
      center: { x: 100, y: 100 },
      width: 0.5,
      height: 0.5,
      zLayers: [0],
      ownerNetIds: new Set(["distant-owner"]),
    },
    {
      kind: "fixed-rectangle",
      center: { x: 0.25, y: 0.5 },
      width: 1,
      height: 1,
      zLayers: [1],
      ownerNetIds: new Set(["other-layer-owner"]),
    },
  )
  const netIds = [
    ...input.routableNetIds,
    "shared-owner",
    "distant-owner",
    "other-layer-owner",
    "unowned-route",
  ]
  const context = {
    ...input,
    rectangles,
    routableNetIds: new Set(netIds),
    clearanceIndex: new FixedCopperClearanceIndex({
      rectangles,
      layerCount: input.layerCount,
      minClearance: input.padGap,
    }),
  }
  const result = getNetAwareCrampedPortSites(context)
  expect(result.status).toBe("complete")
  if (result.status !== "complete") {
    throw new Error("The ownership-equivalent corridor must be resolved")
  }
  expect(
    result.netClasses.map((entry): readonly string[] => entry.netIds),
  ).toEqual([
    ["distant-owner", "other-layer-owner", "unowned-route"],
    ["right-net"],
    ["route-net", "shared-owner"],
    ["upper-net"],
  ])
  expect(result.sites[0]!.allowedNetIds).toEqual(["route-net", "shared-owner"])
  expect(result.sites[1]!.allowedNetIds).toEqual(["upper-net"])
  expect(
    getNetAwareCrampedPortSites({
      ...context,
      rectangles: [...rectangles].reverse(),
      routableNetIds: new Set([...netIds].reverse()),
    }),
  ).toEqual(result)
})
