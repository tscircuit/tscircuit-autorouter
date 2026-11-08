import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getObstacleClearanceInterval } from "lib/solvers/UniformPortDistributionSolver/getObstacleClearanceInterval"
import type { SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("physical port capacity preserves the opening between SRJ18's rotated pads", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 9)
  const original = JSON.stringify(scenario)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  while (!solver.portPointPathingSolver && !solver.failed) solver.step()
  expect(solver.failed).toBeFalse()
  const graph =
    solver.portPointPathingSolver!["tinyPipelineSolver"].inputProblem
      .serializedHyperGraph
  const port = graph.ports.find(
    (port) => port.portId === "ce5169_pp0_z0_cramped::0",
  )!
  expect(port).toBeDefined()
  expect(port.d?.clearanceAllowedNetIds).toBeUndefined()
  const approximate = solver.srjWithPointPairs!.obstacles
  const physical = solver.physicalRoutingObstacles!
  expect(physical.some((pad) => pad.ccwRotationDegrees === 225)).toBeTrue()
  const generatedIds = [
    ...solver.escapeViaLocationSolver!.getEscapeViaMetadataByPointId().keys(),
  ].map((id) => `escape-via-obstacle:${id}`)
  expect(
    generatedIds.every((id) => physical.some((o) => o.obstacleId === id)),
  ).toBeTrue()
  expect(JSON.stringify(scenario)).toBe(original)
  const edge: SharedEdge = {
    ownerNodeIds: [port.region1Id, port.region2Id],
    ownerPairKey: `${port.region1Id}|${port.region2Id}`,
    orientation: "vertical",
    x1: 5.057322,
    x2: 5.057322,
    y1: -2.5824482429150955,
    y2: -2.4175517570849045,
    center: { x: 5.057322, y: -2.5 },
    length: 0.1648964858301909,
    nodeSideByOwnerId: {},
  }
  const blockedAtCenter = (obstacles: typeof physical): boolean =>
    obstacles.some((pad) => {
      if (!pad.layers.includes("top")) return false
      const interval = getObstacleClearanceInterval(edge, pad, 0.15)
      return (
        interval !== undefined && interval.min < -2.5 && interval.max > -2.5
      )
    })
  expect(blockedAtCenter(approximate)).toBeTrue()
  expect(blockedAtCenter(physical)).toBeFalse()
  const viewbox = { minX: 4.8, maxX: 5.7, minY: -3.3, maxY: -1.7 }
  for (const [name, obstacles] of [
    ["before", approximate],
    ["after", physical],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...scenario,
      obstacles: obstacles.filter((obstacle) =>
        obstacle.layers.includes("top"),
      ),
      connections: [],
      traces: [],
    })
    graphics.circles.push({
      center: { x: 5.057322, y: -2.5 },
      radius: 0.15,
      fill: "none",
      stroke: "#16a34a",
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "SRJ18 sample 9: preserve exact pad geometry",
        name === "before"
          ? "Approximation closes the physical clearance opening"
          : "Exact rotated pads leave the declared 0.1 mm copper clearance",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
