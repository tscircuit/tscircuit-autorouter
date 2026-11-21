import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("plans inner1 DDR crossings between the two fixed iCEPi fanout vias", async (): Promise<void> => {
  const fixture = new URL(
    "../fixtures/assets/icepi-native-ddr-gap-ports.srj.json.gz",
    import.meta.url,
  )
  const { inputSrj }: { inputSrj: SimpleRouteJson } = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixture))).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  while (!solver.failed && !solver.uniformPortDistributionSolver?.solved) {
    solver.step()
  }
  expect(solver.failed).toBeFalse()
  // Board-world millimetres. These fixed via lands straddle the inner1 cell.
  const center = { x: 14.7, y: 4.9 }
  const plannedNodes = solver.uniformPortDistributionSolver!.getOutput()
  const node = plannedNodes.find(
    (node) =>
      Math.hypot(node.center.x - center.x, node.center.y - center.y) < 1e-6 &&
      node.availableZ?.includes(1),
  )
  const crossings = (node?.portPointsInPairs ?? []).filter(
    ([a, b]) => a.z === 1 && b.z === 1,
  )
  const lands = inputSrj.traces!.flatMap((trace) =>
    trace.route.flatMap((point) =>
      point.route_type === "via" &&
      Math.hypot(point.x - center.x, point.y - center.y) < 0.5
        ? [
            {
              center: { x: point.x, y: point.y },
              radius: inputSrj.minViaDiameter! / 2,
              fill: "#64748b",
            },
          ]
        : [],
    ),
  )
  expect(lands).toHaveLength(2)
  const overlappingPairs = crossings.flatMap(([a, b], index) =>
    crossings.slice(0, index).filter(([c, d]) => {
      if (a.rootConnectionName === c.rootConnectionName) return false
      return [a, b].some((p) =>
        [c, d].some(
          (q) =>
            Math.hypot(p.x - q.x, p.y - q.y) < inputSrj.minTraceWidth - 1e-6,
        ),
      )
    }),
  )
  expect(overlappingPairs).toHaveLength(0)
  const svg = getSvgFromGraphicsObject(
    {
      rects: [
        {
          center,
          width: 0.24,
          height: 0.24,
          fill: "none",
          stroke: "#94a3b8",
        },
      ],
      circles: lands,
      lines: crossings.map(([entry, exit]) => ({
        points: [entry, exit],
        strokeWidth: inputSrj.minTraceWidth,
        strokeColor:
          entry.rootConnectionName === "source_net_2"
            ? "#0284c7ba"
            : "#c2410cba",
        label: entry.connectionName,
      })),
      texts: [
        {
          x: 14.11,
          y: 4.24,
          text: "iCEPi DDR · inner1",
          fontSize: 0.068,
          anchorSide: "center_left",
        },
        {
          x: 14.11,
          y: 4.12,
          text: `Planned crossings ${crossings.length} · Overlapping pairs ${overlappingPairs.length}`,
          fontSize: 0.046,
          anchorSide: "center_left",
        },
      ],
    },
    { backgroundColor: "white", svgWidth: 710, svgHeight: 600 },
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
