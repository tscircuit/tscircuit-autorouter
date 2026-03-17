import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, stackGraphicsVertically } from "graphics-debug"
import { AutoroutingPipelineSolver } from "lib"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import bugReport from "../../fixtures/bug-reports/bugreport46-ac4337/bugreport46-ac4337-arduino-uno.json" with {
  type: "json",
}

type WireSegment = {
  connectionName: string
  layer: string
  width: number
  a: { x: number; y: number }
  b: { x: number; y: number }
}

const layers = ["top", "inner1", "inner2", "bottom"] as const

const create4LayerSubset = (): SimpleRouteJson => {
  const srj = structuredClone(bugReport.simple_route_json) as SimpleRouteJson
  srj.layerCount = 4
  srj.connections = srj.connections.slice(0, 4)

  const selectedConnectionNames = new Set(srj.connections.map((c) => c.name))
  srj.obstacles = srj.obstacles.filter(
    (o) =>
      !o.connectedTo ||
      o.connectedTo.length === 0 ||
      o.connectedTo.some((name) => selectedConnectionNames.has(name)),
  )

  return srj
}

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

const toLayerStackedSvg = (traces: SimplifiedPcbTrace[]) => {
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

    for (const trace of traces) {
      let previous: SimplifiedPcbTrace["route"][number] | null = null
      for (const step of trace.route) {
        if (
          step.route_type === "wire" &&
          previous?.route_type === "wire" &&
          previous.layer === layer &&
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

    return { title: layer, lines }
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

test("bugreport46-ac4337 4-layer overlap detection between different nets on z0/z1", async () => {
  const solver = new AutoroutingPipelineSolver(create4LayerSubset(), {
    effort: 0.25,
  })
  solver.solve()

  expect(solver.failed).toBe(false)

  const traces = solver.getOutputSimpleRouteJson().traces ?? []
  const segments = getWireSegments(traces)

  let overlapCount = 0
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const segmentA = segments[i]
      const segmentB = segments[j]

      if (segmentA.connectionName === segmentB.connectionName) continue
      if (segmentA.layer !== segmentB.layer) continue
      if (segmentA.layer !== "top" && segmentA.layer !== "bottom") continue

      const distance = minimumDistanceBetweenSegments(
        segmentA.a,
        segmentA.b,
        segmentB.a,
        segmentB.b,
      )
      const minAllowedDistance = (segmentA.width + segmentB.width) / 2

      if (distance < minAllowedDistance - 1e-6) overlapCount++
    }
  }

  expect(overlapCount).toBeGreaterThan(0)

  const stackedSvg = toLayerStackedSvg(traces)
  await expect(stackedSvg).toMatchSvgSnapshot(import.meta.path)
}, 120_000)
