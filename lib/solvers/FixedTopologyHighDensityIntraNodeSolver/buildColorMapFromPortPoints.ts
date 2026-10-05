import type { NodeWithPortPoints } from "lib/types/high-density-types"

export const buildColorMapFromPortPoints = (
  nodeWithPortPoints: NodeWithPortPoints,
): Record<string, string> => {
  const colors = [
    "#e6194b",
    "#3cb44b",
    "#ffe119",
    "#4363d8",
    "#f58231",
    "#911eb4",
    "#46f0f0",
    "#f032e6",
    "#bcf60c",
    "#fabebe",
  ]

  const colorMap: Record<string, string> = {}
  const connectionNames = new Set<string>()
  for (const pp of nodeWithPortPoints.portPoints) {
    connectionNames.add(pp.connectionName)
  }

  let i = 0
  for (const name of Array.from(connectionNames)) {
    colorMap[name] = colors[i % colors.length]
    i++
  }
  return colorMap
}
