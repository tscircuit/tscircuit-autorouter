import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import {
  MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS,
  shouldRunDuplicateCongestedPortPrepass,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

test("visualizes the duplicate-port prepass connection cutoff", async () => {
  const scenarios = [
    { label: "100-connection graph", connectionCount: 100, y: 0.7 },
    { label: "srj24 sample 4", connectionCount: 841, y: -0.4 },
  ].map((scenario) => ({
    ...scenario,
    shouldRun: shouldRunDuplicateCongestedPortPrepass({
      hasPreloadedTraceOccupancy: false,
      connectionCount: scenario.connectionCount,
    }),
  }))
  const scaleMax = 1_200
  const toX = (connectionCount: number) => (connectionCount / scaleMax) * 4
  const cutoffX = toX(MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS)
  const graphics: GraphicsObject = {
    lines: [
      {
        points: [
          { x: 0, y: 1.2 },
          { x: 4, y: 1.2 },
        ],
        strokeColor: "rgba(60,70,80,0.6)",
        strokeWidth: 0.025,
      },
      {
        points: [
          { x: cutoffX, y: -0.8 },
          { x: cutoffX, y: 1.45 },
        ],
        strokeColor: "rgba(180,90,20,0.9)",
        strokeWidth: 0.035,
        strokeDash: "0.08 0.06",
      },
    ],
    circles: scenarios.map((scenario) => ({
      center: { x: toX(scenario.connectionCount), y: scenario.y },
      radius: 0.12,
      fill: scenario.shouldRun ? "rgba(40,170,95,0.8)" : "rgba(205,65,65,0.8)",
      stroke: scenario.shouldRun ? "rgba(20,105,55,1)" : "rgba(140,30,30,1)",
      label: `${scenario.connectionCount} connections`,
    })),
    texts: [
      {
        x: 0,
        y: 1.28,
        text: "0",
        anchorSide: "bottom_left",
        fontSize: 0.11,
      },
      {
        x: 4,
        y: 1.28,
        text: "1,200 connections",
        anchorSide: "bottom_right",
        fontSize: 0.11,
      },
      {
        x: cutoffX,
        y: 1.48,
        text: `current prepass cutoff: ${MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS}`,
        anchorSide: "bottom_center",
        fontSize: 0.11,
      },
      ...scenarios.map((scenario) => ({
        x: toX(scenario.connectionCount),
        y: scenario.y - 0.2,
        text: `${scenario.label}: ${scenario.shouldRun ? "prepass runs" : "prepass skipped"}`,
        anchorSide: "top_center" as const,
        fontSize: 0.13,
      })),
      {
        x: 0,
        y: -1.05,
        text: "green = prepass runs · red = skipped by the production cutoff",
        anchorSide: "bottom_left",
        fontSize: 0.1,
      },
    ],
  }
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Duplicate-congested-port prepass gate",
        step: 1,
        graphics,
      },
    ],
    columns: 1,
    cellWidth: 4.6,
    cellHeight: 3.1,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
})
