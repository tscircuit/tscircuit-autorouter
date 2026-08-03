import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import {
  getTinyHyperGraphSolveGraphMaxIterations,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const SAMPLE4_CONNECTION_COUNT = 841
const SAMPLE4_REQUIRED_ITERATIONS = 4_205_000
const MAX_CONNECTION_COUNT = 1_000
const X_SCALE = 5 / MAX_CONNECTION_COUNT
const Y_SCALE = 1 / 1_000_000

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
  const sample4MeetsRequiredBudget =
    sample4Budget >= SAMPLE4_REQUIRED_ITERATIONS
  const sample4X = toX(SAMPLE4_CONNECTION_COUNT)
  const sample4Y = toY(sample4Budget)
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
          { x: 0, y: 5.25 },
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
        fill: sample4MeetsRequiredBudget
          ? "rgba(34,197,94,0.9)"
          : "rgba(220,38,38,0.9)",
        stroke: sample4MeetsRequiredBudget
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
        y: 2,
        text: "2M",
        anchorSide: "center_right",
        fontSize: 0.11,
      },
      {
        x: -0.12,
        y: 5,
        text: "5M iterations",
        anchorSide: "center_right",
        fontSize: 0.11,
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
        y: 4.75,
        text: "Blue line = production solveGraph MAX_ITERATIONS at effort 1",
        anchorSide: "bottom_left",
        fontSize: 0.12,
      },
      {
        x: 0.15,
        y: 4.45,
        text: "Hosted reproduction: the fixed 2M budget ended at route 619 of 841",
        anchorSide: "bottom_left",
        fontSize: 0.12,
      },
      {
        x: 0.15,
        y: 4.15,
        text: `${sample4MeetsRequiredBudget ? "Green" : "Red"} sample point = ${
          sample4MeetsRequiredBudget
            ? "graph-sized budget"
            : "budget does not scale with the graph"
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
    cellHeight: 6,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
  expect(sample4Budget).toBeGreaterThanOrEqual(SAMPLE4_REQUIRED_ITERATIONS)
})
