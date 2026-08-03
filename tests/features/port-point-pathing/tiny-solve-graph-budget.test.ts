import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { getTinyHyperGraphSolveGraphMaxIterations } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const SMALL_GRAPH_CONNECTION_COUNT = 100
const SAMPLE4_CONNECTION_COUNT = 841
const MAX_DISPLAY_ITERATIONS = 32_000_000
const CHART_HEIGHT = 4

const toChartHeight = (iterations: number) =>
  (iterations / MAX_DISPLAY_ITERATIONS) * CHART_HEIGHT

test("Tiny solveGraph budget grows with the number of routes", async () => {
  const smallGraphBudget = getTinyHyperGraphSolveGraphMaxIterations({
    effort: 1,
    connectionCount: SMALL_GRAPH_CONNECTION_COUNT,
  })
  const sample4Budget = getTinyHyperGraphSolveGraphMaxIterations({
    effort: 1,
    connectionCount: SAMPLE4_CONNECTION_COUNT,
  })
  const budgetGrowsWithGraph = sample4Budget > smallGraphBudget
  const bars = [
    {
      x: 1.6,
      connectionCount: SMALL_GRAPH_CONNECTION_COUNT,
      budget: smallGraphBudget,
      fill: "rgba(100,116,139,0.7)",
      stroke: "rgba(71,85,105,0.95)",
    },
    {
      x: 3.9,
      connectionCount: SAMPLE4_CONNECTION_COUNT,
      budget: sample4Budget,
      fill: budgetGrowsWithGraph
        ? "rgba(34,197,94,0.72)"
        : "rgba(220,38,38,0.72)",
      stroke: budgetGrowsWithGraph
        ? "rgba(21,128,61,0.98)"
        : "rgba(153,27,27,0.98)",
    },
  ]
  const graphics: GraphicsObject = {
    lines: [
      {
        points: [
          { x: 0.7, y: 0 },
          { x: 5, y: 0 },
        ],
        strokeColor: "rgba(51,65,85,0.8)",
        strokeWidth: 0.025,
      },
      {
        points: [
          { x: 0.7, y: 0 },
          { x: 0.7, y: CHART_HEIGHT },
        ],
        strokeColor: "rgba(51,65,85,0.8)",
        strokeWidth: 0.025,
      },
    ],
    rects: bars.map((bar) => {
      const height = toChartHeight(bar.budget)
      return {
        center: { x: bar.x, y: height / 2 },
        width: 1.3,
        height,
        fill: bar.fill,
        stroke: bar.stroke,
        label: `${bar.connectionCount} routes · ${bar.budget.toLocaleString()} iterations`,
      }
    }),
    texts: [
      ...bars.flatMap((bar) => {
        const height = toChartHeight(bar.budget)
        return [
          {
            x: bar.x,
            y: -0.18,
            text:
              bar.connectionCount === SAMPLE4_CONNECTION_COUNT
                ? "sample 4 · 841 routes"
                : "small graph · 100 routes",
            anchorSide: "top_center" as const,
            fontSize: 0.13,
          },
          {
            x: bar.x,
            y: height + 0.13,
            text: `${(bar.budget / 1_000_000).toFixed(3)}M iterations`,
            anchorSide: "bottom_center" as const,
            fontSize: 0.14,
          },
        ]
      }),
      {
        x: 0.58,
        y: toChartHeight(2_000_000),
        text: "2M",
        anchorSide: "center_right",
        fontSize: 0.12,
      },
      {
        x: 0.58,
        y: toChartHeight(16_000_000),
        text: "16M",
        anchorSide: "center_right",
        fontSize: 0.12,
      },
      {
        x: 0.58,
        y: toChartHeight(32_000_000),
        text: "32M iterations",
        anchorSide: "center_right",
        fontSize: 0.12,
      },
      {
        x: 0.85,
        y: 4.45,
        text: "Production effort-1 solveGraph MAX_ITERATIONS",
        anchorSide: "bottom_left",
        fontSize: 0.14,
      },
      {
        x: 0.85,
        y: 4.16,
        text: budgetGrowsWithGraph
          ? "Green: the larger graph receives a larger search budget"
          : "Red: both graphs stop at the same fixed 2M budget",
        anchorSide: "bottom_left",
        fontSize: 0.14,
      },
    ],
  }
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Tiny solveGraph budget by route count",
        step: 1,
        graphics,
      },
    ],
    columns: 1,
    cellWidth: 5.7,
    cellHeight: 5.4,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
  expect(sample4Budget).toBeGreaterThan(smallGraphBudget)
})
