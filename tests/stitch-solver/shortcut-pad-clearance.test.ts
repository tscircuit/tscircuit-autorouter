import { expect, test } from "bun:test"
import { RouteStitchClearanceValidator } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import type { Obstacle } from "lib/types"

test("stitch shortcuts respect pad copper, clearance, layers, and net aliases", () => {
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 0.4,
    layers: ["top"],
    connectedTo: ["foreign"],
  }
  const createValidator = (pad: Obstacle): RouteStitchClearanceValidator =>
    new RouteStitchClearanceValidator({
      hdRoutes: [
        {
          connectionName: "signal_mst0",
          rootConnectionName: "signal",
          route: [
            { x: -1, y: -1, z: 0 },
            { x: 1, y: -1, z: 0 },
          ],
          vias: [],
          traceThickness: 0.1,
          viaDiameter: 0.3,
        },
      ],
      obstacles: [pad],
      layerCount: 4,
    })
  const segment = {
    connectionName: "signal_mst0",
    start: { x: -1, y: 0, z: 0 },
    end: { x: 1, y: 0, z: 0 },
    traceThickness: 0.1,
  }
  const validator = createValidator(obstacle)

  expect(validator.isSegmentClear(segment)).toBe(false)
  expect(
    validator.isSegmentClear({
      ...segment,
      start: { ...segment.start, y: 0.34 },
      end: { ...segment.end, y: 0.34 },
    }),
  ).toBe(false)
  expect(
    validator.isSegmentClear({
      ...segment,
      start: { ...segment.start, y: 0.36 },
      end: { ...segment.end, y: 0.36 },
    }),
  ).toBe(true)
  expect(
    createValidator({ ...obstacle, layers: ["bottom"] }).isSegmentClear(
      segment,
    ),
  ).toBe(true)
  expect(
    createValidator({ ...obstacle, connectedTo: ["signal"] }).isSegmentClear(
      segment,
    ),
  ).toBe(true)
  expect(
    createValidator({
      ...obstacle,
      width: 1,
      height: 0.1,
      ccwRotationDegrees: 45,
    }).isSegmentClear({
      ...segment,
      start: { x: 0.05, y: 0.33, z: 0 },
      end: { x: 0.6, y: 0.33, z: 0 },
    }),
  ).toBe(false)
})
