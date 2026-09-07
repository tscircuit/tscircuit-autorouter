import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { SimpleRouteJson } from "../../../lib/types/srj-types"

export interface FixedInputManifest {
  schemaVersion: 1
  name: string
  inputFile: string
  inputSha256: string
  description: string
  [key: string]: unknown
}

export interface FixedInput {
  manifest: FixedInputManifest
  manifestPath: string
  inputPath: string
  inputSha256: string
  srj: SimpleRouteJson
}

/** Reject features that cannot be represented identically by both adapters. */
export const validateFixedInput = (srj: SimpleRouteJson): void => {
  if (srj.layerCount !== 2)
    throw new Error("Fixed input requires two outer layers")
  if (srj.traces?.length || srj.jumpers?.length || srj.allowJumpers) {
    throw new Error("Fixed input does not support preloaded copper or jumpers")
  }
  if (
    srj.buses?.length ||
    srj.differentialPairs?.length ||
    srj.outline?.length
  ) {
    throw new Error(
      "Fixed input does not support buses, differential pairs, or polygon outlines",
    )
  }
  if (srj.allowViaInPad !== false)
    throw new Error("Fixed input requires allowViaInPad=false")
  const widths = [srj.minTraceWidth, srj.nominalTraceWidth]
  const clearances = [
    srj.defaultObstacleMargin,
    srj.minTraceToPadEdgeClearance,
    srj.minBoardEdgeClearance,
    srj.minViaEdgeToPadEdgeClearance,
  ]
  if (
    !widths.every((value) => value === 0.15) ||
    !clearances.every((value) => value === 0.15)
  ) {
    throw new Error(
      "Fixed input requires explicit 0.15 mm widths and clearances",
    )
  }
  if (srj.minViaPadDiameter !== 0.6 || srj.minViaHoleDiameter !== 0.3) {
    throw new Error("Fixed input requires explicit 0.6/0.3 mm through vias")
  }
  if (
    srj.minViaDiameter !== undefined ||
    srj.min_via_pad_diameter !== undefined ||
    srj.min_via_hole_diameter !== undefined
  ) {
    throw new Error("Fixed input requires canonical via dimension fields")
  }
  const names = new Set(srj.connections.map((connection) => connection.name))
  if (names.size !== srj.connections.length || names.size === 0) {
    throw new Error("Fixed input requires unique, nonempty connection names")
  }
  for (const connection of srj.connections) {
    if (
      connection.pointsToConnect.length < 2 ||
      connection.nominalTraceWidth !== 0.15
    ) {
      throw new Error(
        `Connection ${connection.name} requires at least two terminals and the common width`,
      )
    }
    if (
      connection.isOffBoard ||
      connection.externallyConnectedPointIds?.length
    ) {
      throw new Error(
        `Connection ${connection.name} has unsupported external connectivity`,
      )
    }
    for (const point of connection.pointsToConnect) {
      const layers = "layers" in point ? point.layers : [point.layer]
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        layers.length === 0 ||
        layers.some((layer) => layer !== "top" && layer !== "bottom") ||
        ("terminalVia" in point && point.terminalVia)
      ) {
        throw new Error(
          `Connection ${connection.name} has an unsupported terminal`,
        )
      }
    }
  }
  for (const obstacle of srj.obstacles) {
    if (
      obstacle.type !== "rect" ||
      obstacle.isCopperPour ||
      obstacle.ccwRotationDegrees ||
      obstacle.zLayers !== undefined ||
      obstacle.__zLayers !== undefined ||
      obstacle.netIsAssignable ||
      obstacle.offBoardConnectsTo?.length ||
      obstacle.layers.length === 0 ||
      obstacle.layers.some((layer) => layer !== "top" && layer !== "bottom") ||
      obstacle.connectedTo.length > 1 ||
      ![
        obstacle.center.x,
        obstacle.center.y,
        obstacle.width,
        obstacle.height,
      ].every(Number.isFinite) ||
      obstacle.width <= 0 ||
      obstacle.height <= 0
    ) {
      throw new Error(`Unsupported obstacle ${obstacle.obstacleId}`)
    }
  }
  if (
    !Object.values(srj.bounds).every(Number.isFinite) ||
    srj.bounds.minX >= srj.bounds.maxX ||
    srj.bounds.minY >= srj.bounds.maxY
  ) {
    throw new Error("Fixed input has invalid board bounds")
  }
}

export const loadFixedInput = async (
  manifestPath: string,
): Promise<FixedInput> => {
  const absoluteManifestPath = resolve(manifestPath)
  const manifest = JSON.parse(
    await readFile(absoluteManifestPath, "utf8"),
  ) as FixedInputManifest
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.name ||
    !manifest.inputFile ||
    !/^[a-f0-9]{64}$/.test(manifest.inputSha256)
  ) {
    throw new Error("Invalid fixed-input manifest")
  }
  const inputPath = resolve(dirname(absoluteManifestPath), manifest.inputFile)
  const bytes = await readFile(inputPath)
  const inputSha256 = createHash("sha256")
    .update(new Uint8Array(bytes))
    .digest("hex")
  if (inputSha256 !== manifest.inputSha256)
    throw new Error("Fixed-input SHA256 does not match manifest")
  const srj = JSON.parse(bytes.toString("utf8")) as SimpleRouteJson
  validateFixedInput(srj)
  return {
    manifest,
    manifestPath: absoluteManifestPath,
    inputPath,
    inputSha256,
    srj,
  }
}
