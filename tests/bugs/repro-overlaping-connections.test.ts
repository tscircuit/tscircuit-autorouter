import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import circuit101 from "../../fixtures/datasets/circuit101.json" with {
  type: "json",
}

type WireSegment = {
  connectionName: string
  layer: string
  width: number
  a: { x: number; y: number }
  b: { x: number; y: number }
}

const layers = ["top", "bottom"]

const getWireSegments = (traces: SimplifiedPcbTrace[]): WireSegment[] => {
  const segments: WireSegment[] = []

  for (const trace of traces) {
    let previous: SimplifiedPcbTrace["route"][number] | null = null

    for (const step of trace.route) {
      if (
        step.route_type === "wire" &&
        previous?.route_type === "wire" &&
        previous.layer === step.layer
      ) {
        segments.push({
          connectionName: trace.connection_name,
          layer: step.layer,
          width: step.width,
          a: { x: previous.x, y: previous.y },
          b: { x: step.x, y: step.y },
        })
      }

      previous = step
    }
  }

  return segments
}

const toLayerStackedSvg = (
  traces: SimplifiedPcbTrace[],
  overlapingSegments: [WireSegment, WireSegment][],
) => {
  const netColor = new Map<string, string>()
  const getColor = (net: string) => {
    if (!netColor.has(net)) {
      const hue = (netColor.size * 67) % 360
      netColor.set(net, `hsl(${hue}, 100%, 40%)`)
    }
    return netColor.get(net)!
  }

  const layerGraphics: GraphicsObject[] = layers.map((layer) => {
    const lines: NonNullable<GraphicsObject["lines"]> = []
    const circles: NonNullable<GraphicsObject["circles"]> = []

    for (const [segmentA, segmentB] of overlapingSegments) {
      if (segmentA.layer !== layer || segmentB.layer !== layer) continue

      const minX = Math.min(
        segmentA.a.x,
        segmentA.b.x,
        segmentB.a.x,
        segmentB.b.x,
      )
      const maxX = Math.max(
        segmentA.a.x,
        segmentA.b.x,
        segmentB.a.x,
        segmentB.b.x,
      )
      const minY = Math.min(
        segmentA.a.y,
        segmentA.b.y,
        segmentB.a.y,
        segmentB.b.y,
      )
      const maxY = Math.max(
        segmentA.a.y,
        segmentA.b.y,
        segmentB.a.y,
        segmentB.b.y,
      )

      const padding = Math.max(segmentA.width, segmentB.width) / 2
      const radius = Math.hypot(maxX - minX, maxY - minY) / 2 + padding

      circles.push({
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        radius,
        stroke: "red",
        fill: "rgba(255, 0, 0, 0.3)",
      })
    }

    for (const trace of traces) {
      let previous: SimplifiedPcbTrace["route"][number] | null = null
      for (const step of trace.route) {
        if (
          step.route_type === "wire" &&
          previous?.route_type === "wire" &&
          // previous.layer === layer &&
          step.layer === layer
        ) {
          lines.push({
            points: [
              { x: previous.x, y: previous.y },
              { x: step.x, y: step.y },
            ],
            strokeColor: getColor(trace.connection_name),
            strokeWidth: Math.max(0.08, step.width),
          })
        }
        previous = step
      }
    }

    return { title: layer, lines, circles }
  })

  const stacked = stackGraphicsVertically(layerGraphics, {
    titles: layers,
  })

  return getSvgFromGraphicsObject(stacked, {
    backgroundColor: "#fff",
    svgWidth: 900,
    svgHeight: 2600,
  })
}

test("overlap detection between different nets", async () => {
  const solver = new AutoroutingPipelineSolver(circuit101 as any)
  solver.solve()

  expect(solver.failed).toBe(false)

  const traces = solver.getOutputSimpleRouteJson().traces ?? []
  const segments = getWireSegments(traces)
  console.log(`segments: ${segments.length}`)

  const overlpaingSegments: [WireSegment, WireSegment][] = []

  let overlapCount = 0
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const segmentA = segments[i]
      const segmentB = segments[j]

      if (segmentA.connectionName === segmentB.connectionName) continue
      if (segmentA.layer !== segmentB.layer) continue

      const distance = minimumDistanceBetweenSegments(
        segmentA.a,
        segmentA.b,
        segmentB.a,
        segmentB.b,
      )

      const minAllowedDistance = (segmentA.width + segmentB.width) / 2

      if (distance < minAllowedDistance - 1e-6) {
        overlpaingSegments.push([segmentA, segmentB])
        overlapCount++
      }
    }
  }

  expect(overlapCount).toBeGreaterThan(0)
  console.log(`overlapCount: ${overlpaingSegments.length}`)

  const stackedSvg = toLayerStackedSvg(traces, overlpaingSegments)
  await expect(stackedSvg).toMatchSvgSnapshot(import.meta.path)
}, 120_000)
