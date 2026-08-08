import { expect, test } from "bun:test"
import e2e3Fixture from "fixtures/legacy/assets/e2e3.json"
import { MultiSectionPortPointOptimizer } from "lib/solvers/MultiSectionPortPointOptimizer/MultiSectionPortPointOptimizer"
import type { SimpleRouteJson } from "lib/types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

test("section optimizer ranks nodes by attempt-reduced failure probability", async () => {
  const optimizer = new MultiSectionPortPointOptimizer({
    simpleRouteJson: e2e3Fixture as SimpleRouteJson,
    inputNodes: [],
    capacityMeshNodes: [],
    capacityMeshEdges: [],
    initialConnectionResults: [],
    initialAssignedPortPoints: new Map(),
    initialNodeAssignedPortPoints: new Map(),
    MAX_ATTEMPTS_PER_NODE: 10,
  })
  optimizer.nodePfMap = new Map([
    ["frequently-attempted", 0.9],
    ["unattempted", 0.3],
  ])
  optimizer.attemptsToFixNode.set("frequently-attempted", 5)

  expect(optimizer.findHighestPfNode()).toBe("unattempted")

  const makePfBars = (values: [number, number], selectedIndex?: number) => ({
    rects: values.map((value, index) => ({
      center: { x: index * 1.5, y: value / 2 },
      width: 0.8,
      height: value,
      fill: index === selectedIndex ? "#22c55e" : "#94a3b8",
      stroke: index === selectedIndex ? "#15803d" : "#475569",
    })),
    texts: [
      { x: 0, y: -0.2, text: "5 attempts", fontSize: 0.13 },
      { x: 1.5, y: -0.2, text: "0 attempts", fontSize: 0.13 },
    ],
  })
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Raw Pf: 0.9 vs 0.3",
        step: 0,
        graphics: makePfBars([0.9, 0.3]),
      },
      {
        name: "Effective Pf: 0.225 vs 0.3; choose right",
        step: 1,
        graphics: makePfBars([0.225, 0.3], 1),
      },
    ],
    columns: 2,
    cellWidth: 2.5,
    cellHeight: 1.4,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
