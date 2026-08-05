import { expect, test } from "bun:test"
import { mergeGraphics, type GraphicsObject } from "graphics-debug"
import { RouteStitchClearanceValidator } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

test("visualizes choosing a clear stitch instead of the nearest colliding stitch", async () => {
  const unsafeNearestRoute: HighDensityIntraNodeRoute = {
    connectionName: "target",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0.8, y: 0, z: 0 },
      { x: 1.5, y: 0, z: 0 },
    ],
    vias: [],
    jumpers: [],
  }
  const clearRoute: HighDensityIntraNodeRoute = {
    connectionName: "target",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1.5, z: 0 },
    ],
    vias: [],
    jumpers: [],
  }
  const foreignRoute: HighDensityIntraNodeRoute = {
    connectionName: "foreign",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0.4, y: -0.5, z: 0 },
      { x: 0.4, y: 0.5, z: 0 },
    ],
    vias: [],
    jumpers: [],
  }
  const clearanceValidator = new RouteStitchClearanceValidator({
    hdRoutes: [unsafeNearestRoute, clearRoute, foreignRoute],
  })
  const existingViolationStitch = {
    connectionName: "existing-violation",
    start: { x: 0.2, y: -0.1, z: 0 },
    end: { x: 0.2, y: 0.1, z: 0 },
    traceThickness: 0.15,
  }
  expect(clearanceValidator.isSegmentClear(existingViolationStitch)).toBe(true)
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "target",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 2, z: 0 },
    hdRoutes: [unsafeNearestRoute, clearRoute],
    isStitchSegmentClear: (stitchSegment) =>
      clearanceValidator.isSegmentClear(stitchSegment),
    stitchClearanceMode: "prefer_clear",
  })
  const foreignCopperGraphics: GraphicsObject = {
    lines: [
      {
        points: foreignRoute.route,
        strokeColor: "red",
        strokeWidth: foreignRoute.traceThickness,
        label: "foreign copper",
      },
    ],
  }
  const beforeSelectionGraphics: GraphicsObject = mergeGraphics(
    mergeGraphics(solver.visualize(), foreignCopperGraphics),
    {
      lines: [
        {
          points: [solver.start, unsafeNearestRoute.route[0]!],
          strokeColor: "red",
          strokeDash: "0.08 0.05",
          label: "nearest stitch crosses foreign copper",
        },
        {
          points: [solver.start, clearRoute.route[0]!],
          strokeColor: "green",
          strokeDash: "0.08 0.05",
          label: "clear stitch candidate",
        },
      ],
    },
  )

  solver.step()

  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    ...clearRoute.route,
  ])
  clearanceValidator.addRoute(solver.mergedHdRoute)
  const laterCrossingStitch = {
    connectionName: "later",
    start: { x: -0.5, y: 0.75, z: 0 },
    end: { x: 0.5, y: 0.75, z: 0 },
    traceThickness: 0.15,
  }
  expect(clearanceValidator.isSegmentClear(laterCrossingStitch)).toBe(false)

  const fallbackRoute: HighDensityIntraNodeRoute = {
    ...unsafeNearestRoute,
    connectionName: "fallback",
  }
  const fallbackValidator = new RouteStitchClearanceValidator({
    hdRoutes: [fallbackRoute, foreignRoute],
  })
  expect(
    fallbackValidator.isSegmentClear({
      connectionName: "fallback",
      start: { x: 0, y: 0, z: 0 },
      end: fallbackRoute.route[0]!,
      traceThickness: fallbackRoute.traceThickness,
    }),
  ).toBe(false)
  const fallbackSolver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "fallback",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2.4, y: 0, z: 0 },
    hdRoutes: [fallbackRoute],
    isStitchSegmentClear: (stitchSegment) =>
      fallbackValidator.isSegmentClear(stitchSegment),
    stitchClearanceMode: "prefer_clear",
  })
  fallbackSolver.step()
  expect(fallbackSolver.failed).toBe(false)
  expect(fallbackSolver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    ...fallbackRoute.route,
  ])

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Before: distance-only choice crosses foreign copper",
          step: 0,
          graphics: beforeSelectionGraphics,
        },
        {
          name: "After: clearance rejects it and selects the clear stitch",
          step: 1,
          graphics: mergeGraphics(solver.visualize(), foreignCopperGraphics),
        },
        {
          name: "Next route: accepted stitches are collision geometry",
          step: "end",
          graphics: mergeGraphics(solver.visualize(), {
            lines: [
              ...foreignCopperGraphics.lines!,
              {
                points: [laterCrossingStitch.start, laterCrossingStitch.end],
                strokeColor: "purple",
                strokeDash: "0.08 0.05",
                label: "rejected later stitch",
              },
            ],
          }),
        },
        {
          name: "No clear alternative: fallback preserves solvability",
          step: "end",
          graphics: mergeGraphics(
            fallbackSolver.visualize(),
            foreignCopperGraphics,
          ),
        },
        {
          name: "Existing violation: a local stitch does not worsen clearance",
          step: "end",
          graphics: mergeGraphics(foreignCopperGraphics, {
            lines: [
              {
                points: [
                  existingViolationStitch.start,
                  existingViolationStitch.end,
                ],
                strokeColor: "green",
                strokeWidth: existingViolationStitch.traceThickness,
                label: "allowed clearance-preserving stitch",
              },
            ],
            points: [
              {
                ...existingViolationStitch.start,
                color: "green",
                label: "existing violation",
              },
              {
                ...existingViolationStitch.end,
                color: "green",
                label: "existing violation",
              },
            ],
          }),
        },
      ],
      columns: 2,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
