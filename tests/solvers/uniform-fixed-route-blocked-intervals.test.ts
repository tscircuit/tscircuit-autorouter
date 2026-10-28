import { expect, test } from "bun:test"
import { getFixedRouteBlockedIntervals } from "lib/solvers/UniformPortDistributionSolver/getFixedRouteBlockedIntervals"
import type { SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("fixed copper reservations use exact open capsule intervals on each edge orientation and layer", () => {
  const horizontalEdge: SharedEdge = {
    ownerNodeIds: ["a", "b"],
    ownerPairKey: "a_b",
    orientation: "horizontal",
    x1: 0,
    y1: 0,
    x2: 10,
    y2: 0,
    center: { x: 5, y: 0 },
    length: 10,
    nodeSideByOwnerId: { a: "top", b: "bottom" },
  }
  const route: HighDensityRoute = {
    connectionName: "fixed-piece",
    rootConnectionName: "fixed-root",
    traceThickness: 1,
    viaDiameter: 2,
    route: [
      { x: 5, y: -2, z: 0 },
      { x: 5, y: 2, z: 0 },
    ],
    vias: [],
  }
  const cases = [
    { points: route.route, expected: [{ start: 4, end: 6 }] },
    {
      points: [
        { x: 2, y: -2, z: 0 },
        { x: 8, y: 4, z: 0 },
      ],
      expected: [{ start: 4 - Math.SQRT2, end: 4 + Math.SQRT2 }],
    },
    {
      points: [
        { x: 5, y: 0.5, z: 0 },
        { x: 8, y: 0.5, z: 0 },
      ],
      expected: [{ start: 5 - Math.sqrt(0.75), end: 8 + Math.sqrt(0.75) }],
    },
    {
      points: [
        { x: -1, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
      ],
      expected: [{ start: -2, end: 1.5 }],
    },
    {
      points: [
        { x: 2, y: 2, z: 0 },
        { x: 3, y: 3, z: 0 },
      ],
      expected: [],
    },
    {
      points: [
        { x: 2, y: 1, z: 0 },
        { x: 8, y: 1, z: 0 },
      ],
      expected: [],
    },
  ]
  const defaults = {
    sharedEdge: horizontalEdge,
    fixedRoutes: [route],
    z: 0,
    netId: "moving-net",
    traceWidth: 1,
    clearance: 0,
    netByConnectionName: new Map([["fixed-root", "fixed-net"]]),
  }
  for (const vertical of [false, true]) {
    const sharedEdge: SharedEdge = vertical
      ? {
          ...horizontalEdge,
          orientation: "vertical",
          x2: 0,
          y2: 10,
          center: { x: 0, y: 5 },
        }
      : horizontalEdge
    for (const { points, expected } of cases) {
      const actual = getFixedRouteBlockedIntervals({
        ...defaults,
        sharedEdge,
        fixedRoutes: [
          {
            ...route,
            route: points.map((point) =>
              vertical ? { ...point, x: point.y, y: point.x } : point,
            ),
          },
        ],
      })
      expect(actual).toHaveLength(expected.length)
      for (let index = 0; index < expected.length; index++) {
        expect(actual[index]!.start).toBeCloseTo(expected[index]!.start, 12)
        expect(actual[index]!.end).toBeCloseTo(expected[index]!.end, 12)
      }
    }
  }

  expect(getFixedRouteBlockedIntervals({ ...defaults, z: 1 })).toEqual([])
  expect(
    getFixedRouteBlockedIntervals({ ...defaults, netId: "fixed-net" }),
  ).toEqual([])
  expect(
    getFixedRouteBlockedIntervals({
      ...defaults,
      clearance: 0.5,
      fixedRoutes: [
        {
          ...route,
          route: [route.route[0]!, { ...route.route[1]!, traceThickness: 3 }],
        },
      ],
    }),
  ).toEqual([{ start: 2.5, end: 7.5 }])
  expect(
    getFixedRouteBlockedIntervals({
      ...defaults,
      z: 1,
      fixedRoutes: [
        {
          ...route,
          route: [
            { x: 5, y: 0, z: 0 },
            { x: 5, y: 0, z: 2 },
          ],
        },
      ],
    }),
  ).toEqual([{ start: 3.5, end: 6.5 }])
  expect(
    getFixedRouteBlockedIntervals({
      ...defaults,
      fixedRoutes: [2, 4].map((x) => ({
        ...route,
        route: [
          { x, y: 0, z: 0 },
          { x, y: 0, z: 0 },
        ],
      })),
    }),
  ).toEqual([
    { start: 1, end: 3 },
    { start: 3, end: 5 },
  ])
  expect(() =>
    getFixedRouteBlockedIntervals({
      ...defaults,
      netByConnectionName: new Map(),
    }),
  ).toThrow("UniformPortDistributionMissingFixedRouteNetIdentity")
  expect(() =>
    getFixedRouteBlockedIntervals({
      ...defaults,
      fixedRoutes: [
        { ...route, route: [route.route[0]!, { ...route.route[1]!, z: 1 }] },
      ],
    }),
  ).toThrow("UniformPortDistributionInvalidFixedRouteGeometry")
})
