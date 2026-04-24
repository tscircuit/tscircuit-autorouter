import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import input from "./high-density-reentry01-input.json"

export default () => {
  const nodePortPoints = input.nodePortPoints
  const colorMap = generateColorMapFromNodeWithPortPoints(nodePortPoints[0])

  return (
    <GenericSolverDebugger
      solver={
        new HighDensitySolver({
          nodePortPoints,
          colorMap,
        }) as any
      }
    />
  )
}
