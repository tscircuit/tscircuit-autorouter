import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("plans the A64 data strobes beside fixed inner-layer DQ13 copper", async (): Promise<void> => {
  const fixture = new URL(
    "../fixtures/a64-fixed-trace-handoff.srj.json.gz",
    import.meta.url,
  )
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixture))).toString(),
  )
  for (const trace of input.traces!) trace.isFixed = true
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  while (!solver.failed && !solver.portPointPathingSolver?.solved) solver.step()
  expect(solver.portPointPathingSolver?.solved).toBeTrue()

  // Use board coordinates so the same cell can be inspected after it is split by layer.
  const cell = { center: { x: 1.575, y: -10.225 }, width: 0.35, height: 0.35 }
  const nodes = solver.portPointPathingSolver!.getOutput().nodesWithPortPoints
  const inCell = nodes.filter(
    (node) =>
      Math.hypot(node.center.x - cell.center.x, node.center.y - cell.center.y) <
      1e-6,
  )
  const pairs = inCell.flatMap((node) => node.portPointsInPairs!)
  expect(pairs.length).toBeGreaterThan(0)
  const layerChanges = pairs.filter(([entry, exit]) => entry.z !== exit.z)

  const dq13 = input.traces!.find(
    (trace) => trace.connection_name === "source_net_31",
  )!
  const corners = [-1, 1].flatMap((x) =>
    [-1, 1].map((y) => ({
      x: cell.center.x + (x * cell.width) / 2,
      y: cell.center.y + (y * cell.height) / 2,
    })),
  )
  const coveringWire = dq13.route.flatMap((start, i) => {
    const end = dq13.route[i + 1]
    if (
      start.route_type !== "wire" ||
      end?.route_type !== "wire" ||
      start.layer !== "inner3" ||
      end.layer !== start.layer
    )
      return []
    const radius = (start.width + solver.viaDiameter) / 2
    return corners.every((p) => pointToSegmentDistance(p, start, end) < radius)
      ? [{ points: [start, end], width: start.width }]
      : []
  })
  expect(coveringWire).toHaveLength(1)
  const wire = coveringWire[0]!

  const svg = getSvgFromGraphicsObject(
    {
      coordinateSystem: "cartesian",
      lines: [
        {
          points: wire.points,
          strokeWidth: wire.width + solver.viaDiameter,
          strokeColor: "#fde9be",
        },
        {
          points: wire.points,
          strokeWidth: wire.width,
          strokeColor: "#ac5e0b",
        },
        ...layerChanges.map(([entry, exit]) => ({
          points: [entry, exit],
          strokeColor: "#823655",
          strokeWidth: 0.009,
          strokeDash: "4 3",
        })),
      ],
      circles: layerChanges.flatMap((pair) =>
        pair.map((center) => ({ center, radius: 0.012, fill: "#823655" })),
      ),
      polygons: [
        {
          points: [corners[0]!, corners[2]!, corners[3]!, corners[1]!],
          fill: "none",
          stroke: "#243d53",
          strokeWidth: 0.005,
        },
      ],
      texts: [
        {
          x: 1.82,
          y: -10.1,
          text: "A64 DDR strobe routing",
          fontSize: 0.037,
          anchorSide: "center_left",
        },
        {
          x: 1.82,
          y: -10.18,
          text: "DQ13 copper on inner3",
          color: "#844600",
          fontSize: 0.029,
          anchorSide: "center_left",
        },
        {
          x: 1.82,
          y: -10.25,
          text: "Via centers overlapping DQ13",
          fontSize: 0.029,
          anchorSide: "center_left",
        },
        {
          x: 1.82,
          y: -10.32,
          text: `${layerChanges.length} planned layer changes in cell`,
          color: "#823655",
          fontSize: 0.029,
          anchorSide: "center_left",
        },
      ],
    },
    { backgroundColor: "white", svgWidth: 800, svgHeight: 420 },
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
  expect(layerChanges).toEqual([])
})
