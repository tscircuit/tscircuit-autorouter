import type { SimpleRouteJson } from "lib/types"
import savedInput from "./input.srj.json"
import vssaInput from "./vssa-phase.input.srj.json"

export const getDeskFidgetMinimumWidthInput = (
  policy: "nominal" | "minimum",
): SimpleRouteJson => {
  const input = structuredClone(savedInput) as SimpleRouteJson
  if (policy === "minimum") {
    for (const connection of input.connections) {
      if (connection.nominalTraceWidth === 0.15) {
        connection.minTraceWidth = 0.15
      }
    }
  }
  return input
}

export const getDeskFidgetVssaMinimumWidthInput = (): SimpleRouteJson => {
  const input = structuredClone(vssaInput) as SimpleRouteJson
  const connection = input.connections[0]!
  connection.minTraceWidth = 0.15
  return input
}
