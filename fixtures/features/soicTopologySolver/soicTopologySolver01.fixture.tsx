import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { SoicTopologyGeneratorSolver } from "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"
import type { SimpleRouteJson } from "lib/types"
import input from "./soicTopologySolver01-input.json"

const componentId = "U_SOIC8"
const componentBounds = {
  __type: "rect" as const,
  minX: -1.16,
  maxX: 1.16,
  minY: -1.44,
  maxY: 1.44,
}

const createSolver = () =>
  new SoicTopologyGeneratorSolver({
    inputSrj: structuredClone(input) as SimpleRouteJson,
    detectedComponent: {
      componentId,
      componentKind: "soic",
      bounds: componentBounds,
    },
    obstacleMargin: input.defaultObstacleMargin,
    viaDiameter: input.minViaPadDiameter,
  })

export default () => <GenericSolverDebugger createSolver={createSolver} />
