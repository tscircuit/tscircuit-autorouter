import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"

export type Pad = Obstacle & { __zLayers: number[] }
export type TerminalPosition = { routeIndex: number; index: number }
export type PadJunctionSimplificationInput = {
  hdRoutes: ReadonlyArray<HighDensityRoute>
  otherHdRoutes?: ReadonlyArray<HighDensityRoute>
  obstacles: ReadonlyArray<Obstacle>
  connMap: ConnectivityMap
  colorMap?: Readonly<Record<string, string>>
  layerCount: number
  outline?: ReadonlyArray<{ x: number; y: number }>
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  minTraceToPadEdgeClearance?: number
  minBoardEdgeClearance?: number
}

type ParsedPadJunctionInput = {
  output: HighDensityRoute[]
  pads: Pad[]
  terminalsByNet: Map<string, TerminalPosition[]>
  clearance: number
  boardClearance: number
}

/** Validate input once and index its terminals using the solver's cached net identities. */
export function parsePadJunctionInput(
  input: PadJunctionSimplificationInput,
  getNet: (identity: string) => string,
): ParsedPadJunctionInput {
  const terminalsByNet = new Map<string, TerminalPosition[]>()
  const clearance = input.minTraceToPadEdgeClearance ?? 0.15
  const boardClearance = input.minBoardEdgeClearance ?? 0
  if (
    !Number.isInteger(input.layerCount) ||
    input.layerCount < 1 ||
    !Number.isFinite(clearance) ||
    clearance < 0 ||
    !Number.isFinite(boardClearance) ||
    boardClearance < 0
  )
    throw new Error(
      "PadJunctionSimplificationSolver: invalid layers or clearance",
    )
  if (
    input.bounds &&
    (![
      input.bounds.minX,
      input.bounds.minY,
      input.bounds.maxX,
      input.bounds.maxY,
    ].every(Number.isFinite) ||
      input.bounds.minX >= input.bounds.maxX ||
      input.bounds.minY >= input.bounds.maxY)
  )
    throw new Error("PadJunctionSimplificationSolver: invalid board bounds")
  if (
    input.outline &&
    (input.outline.length < 3 ||
      input.outline.some(
        (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
      ))
  )
    throw new Error("PadJunctionSimplificationSolver: invalid board outline")
  for (const pad of input.obstacles)
    if (
      ![pad.center.x, pad.center.y, pad.width, pad.height].every(
        Number.isFinite,
      ) ||
      pad.width <= 0 ||
      pad.height <= 0 ||
      (pad.ccwRotationDegrees !== undefined &&
        !Number.isFinite(pad.ccwRotationDegrees))
    )
      throw new Error(
        `PadJunctionSimplificationSolver: invalid pad "${pad.obstacleId}"`,
      )
  const output = [...input.hdRoutes]
  const pads = createObjectsWithZLayers(input.obstacles, input.layerCount)
  for (const [routeIndex, route] of output.entries()) {
    if (
      route.route.length === 0 ||
      !Number.isFinite(route.traceThickness) ||
      route.traceThickness <= 0 ||
      !Number.isFinite(route.viaDiameter) ||
      route.viaDiameter <= 0
    )
      throw new Error(
        `PadJunctionSimplificationSolver: invalid route "${route.connectionName}"`,
      )
    const terminalPositions = [
      { routeIndex, index: 0 },
      { routeIndex, index: route.route.length - 1 },
    ]
    for (const terminalPosition of terminalPositions) {
      const point = route.route[terminalPosition.index]!
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isInteger(point.z) ||
        point.z < 0 ||
        point.z >= input.layerCount
      )
        throw new Error(
          `PadJunctionSimplificationSolver: invalid terminal "${route.connectionName}"`,
        )
    }
    const identities = new Set([getNet(route.connectionName)])
    if (route.rootConnectionName)
      identities.add(getNet(route.rootConnectionName))
    for (const net of identities) {
      const indexed = terminalsByNet.get(net)
      if (indexed) indexed.push(...terminalPositions)
      else terminalsByNet.set(net, [...terminalPositions])
    }
  }
  return { output, pads, terminalsByNet, clearance, boardClearance }
}
