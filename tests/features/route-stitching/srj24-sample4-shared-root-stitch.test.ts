import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { srj24Sample4SharedRootStitchFixture } from "./fixtures/srj24-sample4-shared-root-stitch.fixture"

const layerColor = (z: number) => (z === 0 ? "#dc2626" : "#2563eb")

const getInputGraphics = (
  hdRoutes: HighDensityIntraNodeRoute[],
): GraphicsObject => ({
  lines: hdRoutes.flatMap((route) =>
    route.route.slice(0, -1).map((point, index) => ({
      points: [point, route.route[index + 1]!],
      strokeColor:
        point.z === route.route[index + 1]!.z ? layerColor(point.z) : "#6b7280",
      strokeWidth: route.traceThickness,
      label: `${route.connectionName}\nsame root: ${route.rootConnectionName}\nz${point.z} to z${route.route[index + 1]!.z}`,
    })),
  ),
  circles: [
    {
      center: { x: -2, y: -6.15 },
      radius: 0.15,
      fill: "rgba(107, 114, 128, 0.45)",
      stroke: "#374151",
      label: "via: z0 to z5",
    },
  ],
  points: [
    {
      x: -2.8,
      y: -6.15,
      color: "#111827",
      label: "mst24 start\npcb_port_309",
    },
    {
      x: -0.68,
      y: -4.85,
      color: "#111827",
      label: "same-root internal terminal\npcb_port_953",
    },
    {
      x: -2.63,
      y: -5.825,
      color: "#111827",
      label: "mst24 end\npcb_port_775",
    },
  ],
  texts: [
    {
      x: -2.8,
      y: -4.55,
      text: "Red = z0 copper   Blue = z5 copper   Gray = via",
      anchorSide: "bottom_left",
      fontSize: 0.11,
    },
    {
      x: -2.8,
      y: -6.25,
      text: "start: pcb_port_309",
      anchorSide: "top_left",
      fontSize: 0.1,
    },
    {
      x: -0.68,
      y: -4.72,
      text: "internal: pcb_port_953",
      anchorSide: "bottom_right",
      fontSize: 0.1,
    },
    {
      x: -2.63,
      y: -5.7,
      text: "end: pcb_port_775",
      anchorSide: "bottom_center",
      fontSize: 0.1,
    },
  ],
})

test("visualizes sample 4 shared-root terminal stitching", async () => {
  const fixture = structuredClone(srj24Sample4SharedRootStitchFixture)
  let solver: SingleHighDensityRouteStitchSolver3 | undefined
  let stitchError: Error | undefined

  try {
    solver = new SingleHighDensityRouteStitchSolver3({
      ...fixture,
      preserveTerminalPcbPortIds: true,
    })
    while (!solver.solved && !solver.failed) solver.step()
  } catch (error) {
    stitchError = error as Error
  }

  const inputGraphics = getInputGraphics(fixture.hdRoutes)
  const stitchedStartPcbPortId = solver?.mergedHdRoute.startPcbPortId
  const stitchedEndPcbPortId = solver?.mergedHdRoute.endPcbPortId
  const resultGraphics: GraphicsObject = stitchError
    ? {
        ...inputGraphics,
        texts: [
          ...(inputGraphics.texts ?? []),
          {
            x: -2.8,
            y: -6.55,
            text: "Blocked: pcb_port_953 is internal to the same-root path",
            anchorSide: "top_left",
            fontSize: 0.12,
            color: "#b91c1c",
          },
        ],
      }
    : {
        ...inputGraphics,
        lines: [
          ...(inputGraphics.lines ?? []),
          {
            points: solver!.mergedHdRoute.route,
            strokeColor: "#16a34a",
            strokeWidth: 0.035,
            label: `stitched mst24 output\nterminal ids: ${stitchedStartPcbPortId} to ${stitchedEndPcbPortId}`,
          },
        ],
        texts: [
          ...(inputGraphics.texts ?? []),
          {
            x: -2.8,
            y: -6.55,
            text: "Stitched: internal pcb_port_953 stays internal",
            anchorSide: "top_left",
            fontSize: 0.12,
            color: "#15803d",
          },
        ],
      }

  expect(
    fixture.hdRoutes.some(
      (route) =>
        route.startPcbPortId === "pcb_port_953" ||
        route.endPcbPortId === "pcb_port_953",
    ),
  ).toBe(true)
  if (solver) {
    expect([stitchedStartPcbPortId, stitchedEndPcbPortId]).toEqual([
      "pcb_port_309",
      "pcb_port_775",
    ])
  }

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: one source_trace_3 path",
        step: 0,
        graphics: inputGraphics,
      },
      {
        name: stitchError
          ? "Issue: internal terminal rejected"
          : "Result: mst24 endpoints preserved",
        step: solver?.iterations ?? 0,
        graphics: resultGraphics,
      },
    ],
    columns: 2,
    cellWidth: 3.2,
    cellHeight: 2.6,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
})
