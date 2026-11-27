import { expect, test } from "bun:test"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { createBugreport86PortPointPathingSolver } from "../fixtures/createBugreport86PortPointPathingSolver"

test("port point pathing narrow node layer change snapshot", (): void => {
  const { solver, minViaPadDiameter } =
    createBugreport86PortPointPathingSolver()

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const center = { x: -0.56, y: -8.0 }
  const halfSize = 1.8 / 2
  const minX = center.x - halfSize
  const maxX = center.x + halfSize
  const minY = center.y - halfSize
  const maxY = center.y + halfSize

  const output = solver.getOutput()
  const highlightedNodes = output.nodesWithPortPoints.filter((node) => {
    const minDimension = Math.min(node.width, node.height)
    if (minDimension >= minViaPadDiameter) return false
    return (node.portPointsInPairs ?? []).some(([p1, p2]) => p1.z !== p2.z)
  })

  const overlayRects = highlightedNodes.map((node) => {
    const minDimension = Math.min(node.width, node.height)
    return {
      center: node.center,
      width: node.width,
      height: node.height,
      fill: "rgba(217, 70, 239, 0.75)",
      stroke: "#a21caf",
      label: `layer change in ${minDimension.toFixed(2)}mm node`,
    }
  })

  const viz = solver.visualize()

  const filtered: GraphicsObject = {
    rects: [
      ...(viz.rects?.filter(
        (r) =>
          r.center.x >= minX &&
          r.center.x <= maxX &&
          r.center.y >= minY &&
          r.center.y <= maxY,
      ) ?? []),
      ...overlayRects,
    ],
    points: viz.points?.filter(
      (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY,
    ),
    circles: viz.circles?.filter(
      (c) =>
        c.center.x >= minX &&
        c.center.x <= maxX &&
        c.center.y >= minY &&
        c.center.y <= maxY,
    ),
    lines: viz.lines?.filter((l) =>
      l.points.some(
        (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY,
      ),
    ),
    texts: [
      {
        x: center.x,
        y: center.y + halfSize - 0.05,
        text: "Magenta: nodes smaller than a via where a route changes layer",
        fontSize: 0.05,
        anchorSide: "top_center",
      },
    ],
  }

  const svg = getSvgFromGraphicsObject(filtered, { backgroundColor: "white" })
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
