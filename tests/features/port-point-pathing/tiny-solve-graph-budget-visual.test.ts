import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import {
  getTinyHyperGraphSolveGraphContinuationMaxIterations,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import {
  getTinyHyperGraphSolveGraphInitialMaxIterations,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const SMALL_GRAPH_ROUTE_COUNT = 100
const SAMPLE4_ROUTE_COUNT = 841
const MAX_DISPLAY_ITERATIONS = 32_000_000
const CHART_HEIGHT = 4
const ITERATIONS_TO_CHART_HEIGHT = CHART_HEIGHT / MAX_DISPLAY_ITERATIONS

test("visualizes the Tiny solveGraph continuation budget", async () => {
  const initialBudget = getTinyHyperGraphSolveGraphInitialMaxIterations({
    effort: 1,
  })
  const smallGraphBudget = initialBudget
  const sample4Budget =
    getTinyHyperGraphSolveGraphContinuationMaxIterations({
      initialMaxIterations: initialBudget,
      connectionCount: SAMPLE4_ROUTE_COUNT,
    })
  const budgetGrowsWithGraph = sample4Budget > smallGraphBudget
  const bars = [
    {
      x: 1.7,
      routeCount: SMALL_GRAPH_ROUTE_COUNT,
      budget: smallGraphBudget,
      fill: "rgba(100,116,139,0.72)",
      stroke: "rgba(71,85,105,0.98)",
    },
    {
      x: 4.2,
      routeCount: SAMPLE4_ROUTE_COUNT,
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
          { x: 5.3, y: 0 },
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
      const height = bar.budget * ITERATIONS_TO_CHART_HEIGHT
      return {
        center: { x: bar.x, y: height / 2 },
        width: 1.45,
        height,
        fill: bar.fill,
        stroke: bar.stroke,
        label:
          `${bar.routeCount} routes · ` +
          `${bar.budget.toLocaleString()} iterations`,
      }
    }),
    texts: [
      ...bars.flatMap((bar) => {
        const height = bar.budget * ITERATIONS_TO_CHART_HEIGHT
        return [
          {
            x: bar.x,
            y: -0.18,
            text:
              bar.routeCount === SAMPLE4_ROUTE_COUNT
                ? "sample 4 · still unresolved after 2M"
                : "ordinary graph · accepted by 2M",
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
        y: 2_000_000 * ITERATIONS_TO_CHART_HEIGHT,
        text: "2M",
        anchorSide: "center_right",
        fontSize: 0.12,
      },
      {
        x: 0.58,
        y: 16_000_000 * ITERATIONS_TO_CHART_HEIGHT,
        text: "16M",
        anchorSide: "center_right",
        fontSize: 0.12,
      },
      {
        x: 0.58,
        y: 32_000_000 * ITERATIONS_TO_CHART_HEIGHT,
        text: "32M iterations",
        anchorSide: "center_right",
        fontSize: 0.12,
      },
      {
        x: 0.85,
        y: 4.52,
        text: "Tiny solveGraph final search limit at effort 1",
        anchorSide: "bottom_left",
        fontSize: 0.14,
      },
      {
        x: 0.85,
        y: 4.23,
        text: budgetGrowsWithGraph
          ? "Green: only the unresolved search receives more time"
          : "Red: the unresolved search still fails at the initial 2M limit",
        anchorSide: "bottom_left",
        fontSize: 0.14,
      },
    ],
  }

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Tiny solveGraph continuation budget",
        step: 1,
        graphics,
      },
    ],
    columns: 1,
    cellWidth: 6.2,
    cellHeight: 5.5,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
  expect(sample4Budget).toBeGreaterThan(smallGraphBudget)
})
