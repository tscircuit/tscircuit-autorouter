import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { assertDefined } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/assertDefined"
import type { SimpleRouteJson } from "lib/types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

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
  const portPairs = plannedNodes.find(
    (node) =>
      node.availableZ?.includes(1) && distance(node.center, center) < 1e-6,
  )?.portPointsInPairs
  assertDefined(portPairs, "Missing port pairs in the iCEPi inner1 cell")
  const crossings = portPairs.filter(
    ([entry, exit]) => entry.z === 1 && exit.z === 1,
  )
  expect(crossings).toHaveLength(1)

  const fixedTraces = inputSrj.traces!.filter((trace) => trace.isFixed)
  const viaLands = fixedTraces
    .flatMap((trace) => trace.route)
    .filter((point) => point.route_type === "via")
    .filter((via) => distance(via, center) < 0.5)
    .map((via) => ({
      center: { x: via.x, y: via.y },
      radius: inputSrj.minViaDiameter! / 2,
      fill: "#64748b",
    }))
  expect(viaLands).toHaveLength(2)

  const overlappingPairs = crossings.flatMap(([entry, exit], index) =>
    crossings.slice(0, index).filter(([otherEntry, otherExit]) => {
      if (
        solver.connMap.areIdsConnected(
          entry.connectionName,
          otherEntry.connectionName,
        )
      ) {
        return false
      }
      const centerlineDistance = minimumDistanceBetweenSegments(
        entry,
        exit,
        otherEntry,
        otherExit,
      )
      return centerlineDistance < inputSrj.minTraceWidth - 1e-6
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
      circles: viaLands,
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
