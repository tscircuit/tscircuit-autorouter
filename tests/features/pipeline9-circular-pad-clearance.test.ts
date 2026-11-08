import { isCircularObstacle } from "lib/utils/isCircularObstacle"
import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getObstacleClearanceInterval } from "lib/solvers/UniformPortDistributionSolver/getObstacleClearanceInterval"
import type { SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("SRJ18 circular BGA pads retain their corner clearance in graph planning and DRC", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 13)
  const original = JSON.stringify(scenario)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
    cacheProvider: null,
    effort: 1,
  })
  while (!solver.portPointPathingSolver?.solved && !solver.failed) solver.step()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.portPointPathingSolver!.solved).toBeTrue()
  expect(JSON.stringify(scenario)).toBe(original)
  const port = solver.portPointPathingSolver![
    "tinyPipelineSolver"
  ].inputProblem.serializedHyperGraph.ports.find(
    (port) => port.portId === "ce616_pp0_z0_cramped::0",
  )!
  expect(port.d?.clearanceAllowedNetIds).toBeUndefined()
  const edge: SharedEdge = {
    ownerNodeIds: [port.region1Id, port.region2Id],
    ownerPairKey: `${port.region1Id}|${port.region2Id}`,
    orientation: "vertical",
    x1: -38.104994,
    x2: -38.104994,
    y1: -2.305,
    y2: -2.054998,
    center: { x: -38.104994, y: -2.179999 },
    length: 0.250002,
    nodeSideByOwnerId: {},
  }
  const pads = scenario.obstacles.filter(
    (pad) =>
      pad.layers.includes("top") &&
      Math.abs(pad.center.x + 37.979994) < 1e-6 &&
      (Math.abs(pad.center.y + 2.43) < 1e-6 ||
        Math.abs(pad.center.y + 1.929998) < 1e-6),
  )
  expect(pads).toHaveLength(2)
  for (const pad of pads) {
    const squareInterval = getObstacleClearanceInterval(
      edge,
      { ...pad, type: "rect", shape: undefined },
      0.15,
    )!
    expect(squareInterval.min).toBeLessThan(edge.center.y)
    expect(squareInterval.max).toBeGreaterThan(edge.center.y)
    const roundInterval = getObstacleClearanceInterval(
      edge,
      { ...pad, shape: "circle" },
      0.15,
    )!
    expect(
      roundInterval.min > edge.center.y || roundInterval.max < edge.center.y,
    ).toBeTrue()
  }
  const converted = convertToCircuitJson(scenario, [])
  expect(
    converted.find(
      (element) =>
        element.type === "pcb_smtpad" &&
        element.pcb_smtpad_id === "pcb_smtpad_52",
    ),
  ).toMatchObject({ shape: "circle", radius: 0.125 })
  const viewbox = { minX: -38.6, maxX: -37.4, minY: -2.85, maxY: -1.5 }
  const topPads = scenario.obstacles.filter((pad) => pad.layers.includes("top"))
  for (const name of ["before", "after"] as const) {
    const graphics: GraphicsObject = { rects: [], circles: [] }
    for (const pad of topPads) {
      if (name === "after" && isCircularObstacle(pad))
        graphics.circles!.push({
          center: pad.center,
          radius: pad.width / 2,
          fill: "#fca5a5",
          stroke: "#991b1b",
        })
      else
        graphics.rects!.push({
          center: pad.center,
          width: pad.width,
          height: pad.height,
          fill: "#fca5a5",
          stroke: "#991b1b",
        })
    }
    graphics.circles!.push({
      center: edge.center,
      radius: 0.15,
      fill: "none",
      stroke: "#16a34a",
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "SRJ18 sample 13: circular BGA pad clearance",
        name === "before"
          ? "Square approximation blocks the 0.1 mm trace-clearance envelope"
          : "Original round pads leave a legal path around their corners",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
