import type { SimpleRouteJson } from "lib/types"
import savedInput from "./input.srj.json"

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
