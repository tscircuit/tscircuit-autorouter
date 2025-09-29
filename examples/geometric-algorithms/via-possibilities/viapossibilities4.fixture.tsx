import cn48169 from "examples/legacy/assets/cn48169-nodeWithPortPoints.json"
import React from "react"
import { ViaPossibilitiesDebugger } from "./ViaPossibilitiesDebugger"
import { NodeWithPortPoints } from "lib/types/high-density-types"

export default () => {
  // Cast is needed because the imported JSON doesn't perfectly match the type
  const nodeWithPortPoints = cn48169.nodeWithPortPoints as NodeWithPortPoints

  return <ViaPossibilitiesDebugger nodeWithPortPoints={nodeWithPortPoints} />
}
