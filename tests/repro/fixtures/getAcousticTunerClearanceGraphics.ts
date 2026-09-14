import type { GraphicsObject } from "graphics-debug"

type ViaMeasurement = {
  x: number
  y: number
  diameter: number
  clearance: number
}

export function getAcousticTunerClearanceGraphics(
  via: ViaMeasurement,
  requiredClearance: number,
  holeDiameter: number,
): GraphicsObject {
  // Fixed bounds keep the before/after diagrams at the same physical scale.
  const edgeX = -4.5
  const minY = 16.65
  const maxY = 17.65
  return {
    coordinateSystem: "cartesian",
    rects: [
      {
        center: { x: -4.1, y: 17 },
        width: 1.8,
        height: 1.9,
        fill: "white",
        stroke: "white",
      },
      {
        center: { x: edgeX + requiredClearance / 2, y: (minY + maxY) / 2 },
        width: requiredClearance,
        height: maxY - minY,
        fill: "#fef3c7",
        stroke: "#fef3c7",
      },
      {
        center: { x: edgeX, y: (minY + maxY) / 2 },
        width: 0.006,
        height: maxY - minY,
        fill: "#334155",
      },
      {
        center: { x: edgeX + requiredClearance, y: (minY + maxY) / 2 },
        width: 0.004,
        height: maxY - minY,
        fill: "#b45309",
      },
      {
        center: { x: (edgeX + via.x - via.diameter / 2) / 2, y: via.y },
        width: via.clearance,
        height: 0.004,
        fill: "#334155",
      },
      {
        center: { x: via.x - via.diameter / 2, y: via.y },
        width: 0.004,
        height: 0.05,
        fill: "#334155",
      },
    ],
    circles: [
      {
        center: { x: via.x, y: via.y },
        radius: via.diameter / 2,
        fill: "#60a5fa",
        stroke: "#2563eb",
        layer: "z0,1",
      },
      {
        center: { x: via.x, y: via.y },
        radius: holeDiameter / 2,
        fill: "white",
        stroke: "#2563eb",
        layer: "z0,1",
      },
    ],
    texts: [
      {
        x: -4.1,
        y: 17.8,
        text: "Board edge / required copper-free inset",
        fontSize: 0.075,
      },
      {
        x: -4.1,
        y: 16.5,
        text: `Gap: ${via.clearance.toFixed(6)} mm`,
        fontSize: 0.11,
        color: via.clearance >= requiredClearance ? "#166534" : "#b91c1c",
      },
      {
        x: -4.1,
        y: 16.3,
        text: `Required gap: ${requiredClearance} mm`,
        fontSize: 0.09,
      },
      {
        x: -4.1,
        y: 16.15,
        text: `${via.diameter} mm copper / ${holeDiameter} mm drill`,
        fontSize: 0.08,
      },
    ],
  }
}
