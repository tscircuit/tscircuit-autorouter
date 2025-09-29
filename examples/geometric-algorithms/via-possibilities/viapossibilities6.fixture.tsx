import cn62169 from "examples/legacy/assets/cn62169-nodeWithPortPoints.json"
import React from "react"
import { ViaPossibilitiesDebugger } from "./ViaPossibilitiesDebugger"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { ViaPossibilitiesSolver } from "lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver"

export default () => {
  // Cast is needed because the imported JSON doesn't perfectly match the type
  const nodeWithPortPoints = cn62169.nodeWithPortPoints as NodeWithPortPoints

  // return <ViaPossibilitiesDebugger nodeWithPortPoints={nodeWithPortPoints} />
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new ViaPossibilitiesSolver({
          nodeWithPortPoints,
        })
      }
    />
  )
}
