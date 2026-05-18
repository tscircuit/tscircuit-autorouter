import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import bgaComponentSample001 from "./assets/bga_component_sample001.json" with {
  type: "json",
}
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import type { SimpleRouteJson } from "lib/types"

const componentSrj = bgaComponentSample001 as SimpleRouteJson

export default () => {
  const solver = new BgaTopologyGeneratorSolver({
    inputSrj: componentSrj,
    componentId: "bga_component",
  })

  return <GenericSolverDebugger solver={solver} />
}
