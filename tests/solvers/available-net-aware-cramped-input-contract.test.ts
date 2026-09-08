import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { createAvailableNetAwareCrampedPorts } from "../fixtures/availableNetAwareCrampedPorts"

test("Available validates the complete physical source before taking edge-local rectangle subsets", (): void => {
  for (const variant of [
    "width",
    "empty-nets",
    "invalid-net",
    "pad-gap",
    "layers",
    "geometry",
    "distant-invalid",
  ]) {
    const { input } = createAvailableNetAwareCrampedPorts()
    const context = input.physicalCrampedPortContext
    let expected: string
    if (variant === "width") {
      input.physicalCrampedPortContext = { ...context, traceWidth: 0.125 }
      expected = "common physical cramped-port width"
    } else if (variant === "empty-nets") {
      input.physicalCrampedPortContext = {
        ...context,
        routableNetIds: new Set(),
      }
      expected = "common physical cramped-port width"
    } else if (variant === "invalid-net") {
      input.physicalCrampedPortContext = {
        ...context,
        routableNetIds: new Set([""]),
      }
      expected = "canonical cramped-port nets"
    } else if (variant === "pad-gap") {
      input.physicalCrampedPortContext = { ...context, padGap: 0.125 }
      expected = "geometry must match its whole-board index"
    } else if (variant === "layers") {
      input.physicalCrampedPortContext = { ...context, layerCount: 3 }
      expected = "geometry must match its whole-board index"
    } else if (variant === "geometry") {
      input.physicalCrampedPortContext = {
        ...context,
        rectangles: context.rectangles.slice(1),
      }
      expected = "geometry must match its whole-board index"
    } else {
      input.physicalCrampedPortContext = {
        ...context,
        rectangles: [
          ...context.rectangles,
          {
            ...context.rectangles[0]!,
            center: { x: 1000, y: 1000 },
            width: -1,
          },
        ],
      }
      expected = "invalid fixed rectangle 4"
    }
    expect((): void => {
      new AvailableSegmentPointSolver(input)
    }).toThrow(expected)
  }
  const { input } = createAvailableNetAwareCrampedPorts()
  const initial = new AvailableSegmentPointSolver(input)
  const mutableRectangles = input.physicalCrampedPortContext.rectangles.map(
    (rectangle): {
      kind: "fixed-rectangle"
      center: { x: number; y: number }
      width: number
      height: number
      ccwRotationDegrees?: number
      zLayers: number[]
      ownerNetIds: Set<string>
    } => ({
      ...rectangle,
      center: { ...rectangle.center },
      zLayers: [...rectangle.zLayers],
      ownerNetIds: new Set(rectangle.ownerNetIds),
    }),
  )
  const mutableNets = new Set(input.physicalCrampedPortContext.routableNetIds)
  input.physicalCrampedPortContext = {
    ...input.physicalCrampedPortContext,
    rectangles: mutableRectangles,
    routableNetIds: mutableNets,
  }
  const isolated = new AvailableSegmentPointSolver(input)
  mutableRectangles[0]!.center.y = 100
  mutableRectangles[0]!.ownerNetIds.clear()
  mutableRectangles[0]!.zLayers.splice(0, 1, 1)
  mutableNets.clear()
  mutableNets.add("later-net")
  initial.solve()
  isolated.solve()
  expect(isolated.getOutput()).toEqual(initial.getOutput())
  expect(isolated.edgeSegmentMap.get("left-turn")!.portPoints).toHaveLength(3)
  expect(mutableNets).toEqual(new Set(["later-net"]))
  expect(mutableRectangles[0]!.center.y).toBe(100)
})
