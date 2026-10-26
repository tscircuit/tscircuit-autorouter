import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import { isOpaqueUnownedObstacle } from "lib/utils/isOpaqueUnownedObstacle"

export type PhysicalObstacleShape = {
  kind: "rect" | "oval"
  width: number
  height: number
}
export type PreparedPhysicalObstacle = {
  layers: Set<number>
  owners: Set<string>
  x: number
  y: number
  cosine: number
  sine: number
  engineShape?: PhysicalObstacleShape
  rawShape?: PhysicalObstacleShape
  opaque: boolean
  nonPlatedHole: boolean
}

/** Preserve both DRC representations when preparing authoritative static copper. */
export function preparePipeline9PhysicalObstacle(
  raw: Obstacle,
  connMap: ConnectivityMap,
): PreparedPhysicalObstacle {
  const obstacleType = raw.type as string
  const angle = ((raw.ccwRotationDegrees ?? 0) * Math.PI) / 180
  if (!Number.isFinite(angle))
    throw new Error(
      "Physical segment validation requires finite obstacle rotation",
    )
  const recognized = raw.connectedTo.some((name) =>
    /^(pcb_smtpad_|pcb_plated_hole_|pcb_port_)/.test(name),
  )
  const squarePlated =
    obstacleType === "rect" &&
    raw.layers.length > 1 &&
    Math.abs(raw.width - raw.height) < 0.001
  const needsRaw =
    !recognized ||
    Math.abs((raw.ccwRotationDegrees ?? 0) % 180) > 1e-8 ||
    squarePlated
  if (obstacleType !== "rect" && obstacleType !== "oval")
    throw new Error(
      "Physical segment validation found an unsupported obstacle shape",
    )
  const rawCircle = raw.isNonPlatedHole && raw.shape === "circle"
  const engineCircle =
    raw.ccwRotationDegrees === undefined &&
    raw.layers.length > 1 &&
    Math.abs(raw.width - raw.height) < 0.001
  return {
    layers: new Set(raw.__zLayers),
    owners: new Set(
      raw.connectedTo.map((name) => connMap.getNetConnectedToId(name) ?? name),
    ),
    x: raw.center.x,
    y: raw.center.y,
    cosine: Math.cos(angle),
    sine: Math.sin(angle),
    engineShape: recognized
      ? {
          kind: engineCircle ? "oval" : "rect",
          width: raw.width,
          height: engineCircle ? raw.width : raw.height,
        }
      : undefined,
    rawShape: needsRaw
      ? {
          kind: rawCircle || obstacleType === "oval" ? "oval" : "rect",
          width: raw.width,
          height: rawCircle ? raw.width : raw.height,
        }
      : undefined,
    opaque: isOpaqueUnownedObstacle(raw),
    nonPlatedHole: raw.isNonPlatedHole === true,
  }
}
