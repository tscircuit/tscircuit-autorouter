import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import savedInput from "./input.srj.json"

type MinimumWidthInput = Omit<SimpleRouteJson, "connections"> & {
  connections: Array<SimpleRouteConnection & { minTraceWidth?: number }>
}

export const getDeskFidgetMinimumWidthInput = (
  policy: "nominal" | "minimum",
): MinimumWidthInput => {
  const input = structuredClone(savedInput) as MinimumWidthInput
  if (policy === "minimum") {
    for (const connection of input.connections) {
      if (connection.nominalTraceWidth === 0.15) {
        connection.minTraceWidth = 0.15
      }
    }
  }
  return input
}
