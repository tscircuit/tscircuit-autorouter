import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { getSimpleRouteJsonFromCircuitJson } from "@tscircuit/core"
import { KicadToCircuitJsonConverter } from "kicad-to-circuit-json"
import type { SimpleRouteJson } from "lib/types"

type CircuitJsonElement = Record<string, any>

const getBoardWithCenter = (
  element: CircuitJsonElement,
): CircuitJsonElement => {
  if (
    element.type !== "pcb_board" ||
    "center" in element ||
    !Array.isArray(element.outline)
  ) {
    return element
  }

  const xs = element.outline.map((point) => point.x)
  const ys = element.outline.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  return {
    ...element,
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    },
    width: element.width ?? maxX - minX,
    height: element.height ?? maxY - minY,
  }
}

const normalizeCircuitJsonForCoreSimpleRouteJson = (
  circuitJson: CircuitJsonElement[],
) => circuitJson.map(getBoardWithCenter)

export const convertKicadPcbFileToCircuitJson = (filePath: string) => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(basename(filePath), readFileSync(filePath, "utf8"))
  converter.runUntilFinished()

  return {
    circuitJson: converter.getOutput() as CircuitJsonElement[],
    warnings: converter.getWarnings(),
    stats: converter.getStats(),
  }
}

export const convertKicadPcbFileToSimpleRouteJson = (filePath: string) => {
  const { circuitJson, warnings, stats } =
    convertKicadPcbFileToCircuitJson(filePath)
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson: normalizeCircuitJsonForCoreSimpleRouteJson(circuitJson) as any,
  })

  return {
    circuitJson,
    simpleRouteJson: simpleRouteJson as SimpleRouteJson,
    warnings,
    stats,
  }
}
