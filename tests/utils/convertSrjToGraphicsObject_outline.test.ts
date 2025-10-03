import { describe, expect, test } from "bun:test"
import { convertSrjToGraphicsObject } from "../../lib"
import type { SimpleRouteJson } from "../../lib/types"

describe("convertSrjToGraphicsObject - outline rendering", () => {
  test("renders an outline that is not explicitly closed by repeating the first point", () => {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [],
      connections: [],
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
      outline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        // note: no closing point here
      ],
    }

    const gfx = convertSrjToGraphicsObject(srj)
    const outlineLine = gfx.lines.find(
      (l) => l.strokeColor === "rgba(0, 136, 255, 0.95)",
    )
    expect(outlineLine).toBeTruthy()
    expect(outlineLine!.strokeWidth).toBe(0.2)
    expect(outlineLine!.points.length).toBe(srj.outline!.length + 1) // closed by repeating first point
    const first = outlineLine!.points[0]
    const last = outlineLine!.points[outlineLine!.points.length - 1]
    expect(last).toEqual(first)
  })

  test("keeps an already-closed outline unchanged (no duplicate closing added)", () => {
    const closedOutline = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
      { x: -5, y: -5 }, // explicitly closed
    ]
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [],
      connections: [],
      bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
      outline: closedOutline,
    }

    const gfx = convertSrjToGraphicsObject(srj)
    const outlineLine = gfx.lines.find(
      (l) => l.strokeColor === "rgba(0, 136, 255, 0.95)",
    )
    expect(outlineLine).toBeTruthy()
    expect(outlineLine!.points.length).toBe(closedOutline.length) // unchanged
    expect(outlineLine!.points[0]).toEqual(
      outlineLine!.points[outlineLine!.points.length - 1],
    )
  })
})
