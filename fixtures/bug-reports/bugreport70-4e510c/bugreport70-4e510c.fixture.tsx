// @ts-nocheck
import { InteractiveGraphics } from "graphics-debug/react"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import phaseInputs from "./bugreport70-4e510c.phase-inputs.srj.json"

export default () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(phaseInputs[0])
  solver.solve()

  return <InteractiveGraphics graphics={solver.visualize()} />
}
