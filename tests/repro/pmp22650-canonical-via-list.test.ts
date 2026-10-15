import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"

// Exact route slice captured from PMP22650 (dataset 24, sample 24).
const pmp22650Route: HighDensityRoute = {
  connectionName: "source_net_altium_pcb_95",
  rootConnectionName: "source_net_altium_pcb_95",
  startPcbPortId: "pcb_port_altium_6778",
  endPcbPortId: "pcb_port_altium_7381",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: 160.44751147368083, y: 106.39941010691219, z: 0 },
    { x: 160.26041500691758, y: 106.44015784160167, z: 0 },
    { x: 160.2722894989381, y: 106.44440162826584, z: 0 },
    { x: 159.91255970754966, y: 106.51955232855177, z: 0 },
    { x: 159.91255970754966, y: 106.51955232855177, z: 7 },
    { x: 160.03419741467906, y: 106.66285154015249, z: 7 },
    { x: 160.01706036273447, y: 106.6761644980931, z: 7 },
    { x: 160.03066571726933, y: 106.67049126390494, z: 7 },
    { x: 159.91216553126972, y: 106.51983130036493, z: 7 },
    { x: 159.91216553126972, y: 106.51983130036493, z: 1 },
    { x: 160.03085089447683, y: 106.69227173514574, z: 1 },
    { x: 160.04939214678038, y: 106.9542288280147, z: 1 },
    { x: 160.063, y: 107.43078943218939, z: 1 },
    { x: 159.540388501284, y: 107.95340093090536, z: 1 },
    { x: 159.540388501284, y: 107.9538743025915, z: 1 },
    { x: 159.4944117723919, y: 107.99859592018812, z: 1 },
    { x: 159.4944117723919, y: 107.99859592018812, z: 0 },
    { x: 159.44751147368083, y: 107.94781497227834, z: 0 },
    { x: 159.434271543007, y: 107.93347953629275, z: 0 },
  ],
  vias: [
    { x: 159.91255970754966, y: 106.51955232855177 },
    { x: 159.4944117723919, y: 107.99859592018812 },
  ],
}

test("PMP22650 canonical routes list every exact layer transition as a via", () => {
  const [canonicalRoute] = canonicalizePipeline9HdRoutes([pmp22650Route])
  const layerTransitions = canonicalRoute.route.flatMap(
    (point, index, route) => {
      const nextPoint = route[index + 1]
      return nextPoint &&
        point.z !== nextPoint.z &&
        point.toNextSegmentType !== "through_obstacle" &&
        point.x === nextPoint.x &&
        point.y === nextPoint.y
        ? [{ x: point.x, y: point.y }]
        : []
    },
  )
  const missingVias = layerTransitions.filter(
    (transition) =>
      !canonicalRoute.vias.some(
        (via) => via.x === transition.x && via.y === transition.y,
      ),
  )
  expect(missingVias).toHaveLength(1)

  const layerColors = [
    "#ef4444",
    "#3b82f6",
    "#22c55e",
    "#f59e0b",
    "#a855f7",
    "#06b6d4",
    "#ec4899",
    "#f97316",
  ]
  const graphics: GraphicsObject = {
    title:
      "PMP22650 / source_net_altium_pcb_95 — red ring is an unlisted transition via",
    coordinateSystem: "cartesian",
    lines: canonicalRoute.route.flatMap((point, index, route) => {
      const nextPoint = route[index + 1]
      if (!nextPoint || point.z !== nextPoint.z) return []
      return [
        {
          points: [point, nextPoint],
          strokeColor: layerColors[point.z],
          strokeWidth: 0.1,
        },
      ]
    }),
    circles: [
      ...missingVias.map((via) => ({
        center: via,
        radius: canonicalRoute.viaDiameter * 0.8,
        fill: "#dc2626",
        stroke: "#dc2626",
      })),
      ...canonicalRoute.vias.map((via) => ({
        center: via,
        radius: canonicalRoute.viaDiameter / 2,
        fill: "#22c55e",
        stroke: "#14532d",
      })),
    ],
  }

  expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "#111827",
      svgWidth: 900,
      svgHeight: 500,
      hideInlineLabels: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
