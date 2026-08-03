import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import {
  getTinyHyperGraphSolveGraphMaxIterations,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const SAMPLE4_CONNECTION_COUNT = 841
const LARGEST_HOSTED_FAILED_BUDGET = 4_205_000
const MAX_CONNECTION_COUNT = 1_000
const X_SCALE = 5 / MAX_CONNECTION_COUNT
const Y_SCALE = 5 / 8_000_000

const toX = (connectionCount: number) => connectionCount * X_SCALE
const toY = (iterations: number) => iterations * Y_SCALE

test("visualizes the Tiny solveGraph budget for large route graphs", async () => {
  const budgetCurve = Array.from({ length: 21 }, (_, index) => {
    const connectionCount = index * 50
    return {
      x: toX(connectionCount),
      y: toY(
        getTinyHyperGraphSolveGraphMaxIterations({
          effort: 1,
          connectionCount,
        }),
      ),
    }
  })
  const sample4Budget = getTinyHyperGraphSolveGraphMaxIterations({
    effort: 1,
    connectionCount: SAMPLE4_CONNECTION_COUNT,
  })
  const sample4ExceedsLargestFailedBudget =
    sample4Budget > LARGEST_HOSTED_FAILED_BUDGET
  const sample4X = toX(SAMPLE4_CONNECTION_COUNT)
  const sample4Y = toY(sample4Budget)
  const largestFailedBudgetY = toY(LARGEST_HOSTED_FAILED_BUDGET)
  const graphics: GraphicsObject = {
    lines: [
      {
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        strokeColor: "rgba(60,70,80,0.7)",
        strokeWidth: 0.025,
      },
      {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 5 },
        ],
        strokeColor: "rgba(60,70,80,0.7)",
        strokeWidth: 0.025,
      },
      {
        points: budgetCurve,
        strokeColor: "rgba(37,99,235,0.95)",
        strokeWidth: 0.05,
      },
      {
        points: [
          { x: 0, y: largestFailedBudgetY },
          { x: 5, y: largestFailedBudgetY },
        ],
        strokeColor: "rgba(220,38,38,0.85)",
        strokeWidth: 0.035,
        strokeDash: "0.08 0.06",
      },
      {
        points: [
          { x: sample4X, y: 0 },
          { x: sample4X, y: sample4Y },
        ],
        strokeColor: "rgba(100,116,139,0.75)",
        strokeWidth: 0.025,
        strokeDash: "0.08 0.06",
      },
    ],
    circles: [
      {
        center: { x: sample4X, y: sample4Y },
        radius: 0.1,
        fill: sample4ExceedsLargestFailedBudget
          ? "rgba(34,197,94,0.9)"
          : "rgba(220,38,38,0.9)",
        stroke: sample4ExceedsLargestFailedBudget
          ? "rgba(21,128,61,1)"
          : "rgba(153,27,27,1)",
        label: `${sample4Budget.toLocaleString()} iterations`,
      },
    ],
    texts: [
      {
        x: 0,
        y: -0.2,
        text: "0",
        anchorSide: "top_center",
        fontSize: 0.11,
      },
      {
        x: 5,
        y: -0.2,
        text: "1,000 routes",
        anchorSide: "top_center",
        fontSize: 0.11,
      },
      {
        x: -0.12,
        y: toY(2_000_000),
        text: "2M",
        anchorSide: "center_right",
        fontSize: 0.11,
      },
      {
        x: -0.12,
        y: 5,
        text: "8M iterations",
        anchorSide: "center_right",
        fontSize: 0.11,
      },
      {
        x: 0.15,
        y: largestFailedBudgetY + 0.08,
        text: "4.205M: largest hosted budget that still failed",
        anchorSide: "bottom_left",
        fontSize: 0.11,
        color: "rgba(185,28,28,1)",
      },
      {
        x: sample4X,
        y: sample4Y + 0.18,
        text: `sample 4 · 841 routes · ${(sample4Budget / 1_000_000).toFixed(3)}M budget`,
        anchorSide: "bottom_center",
        fontSize: 0.12,
      },
      {
        x: 0.15,
        y: 5.55,
        text: "Blue line = production solveGraph MAX_ITERATIONS at effort 1",
        anchorSide: "bottom_left",
        fontSize: 0.12,
      },
      {
        x: 0.15,
        y: 5.3,
        text: "Red dashed line = a hosted failure, not a guessed requirement",
        anchorSide: "bottom_left",
        fontSize: 0.12,
      },
      {
        x: 0.15,
        y: 5.05,
        text: `${sample4ExceedsLargestFailedBudget ? "Green" : "Red"} sample point = ${
          sample4ExceedsLargestFailedBudget
            ? "production budget exceeds the known failed budget"
            : "production budget is no better than the known failed budget"
        }`,
        anchorSide: "bottom_left",
        fontSize: 0.12,
      },
    ],
  }
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Tiny solveGraph search budget",
        step: 1,
        graphics,
      },
    ],
    columns: 1,
    cellWidth: 6.2,
    cellHeight: 6.4,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
  expect(sample4Budget).toBeGreaterThan(LARGEST_HOSTED_FAILED_BUDGET)
})
