import cn310 from "examples/legacy/assets/cn310-nodeWithPortPoints.json"
import React from "react"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { ViaPossibilitiesSolver2 } from "lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2"

export default () => {
  // Cast is needed because the imported JSON doesn't perfectly match the type
  const nodeWithPortPoints = cn310.nodeWithPortPoints as NodeWithPortPoints

  // return <ViaPossibilitiesDebugger nodeWithPortPoints={nodeWithPortPoints} />
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new ViaPossibilitiesSolver2({
          nodeWithPortPoints,
        })
      }
    />
  )
}
