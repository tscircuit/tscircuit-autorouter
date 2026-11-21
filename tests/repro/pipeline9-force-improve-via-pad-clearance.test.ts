import { expect, test } from "bun:test"
import {
  createSrj19Sample76ForceImproveSolver,
  findSrj19Sample76ViaPadViolations,
  loadSrj19Sample76ForceImproveInput,
} from "../fixtures/loadSrj19Sample76ForceImproveInput"

test.failing(
  "Pipeline 9 force improvement keeps bga_conn_013 vias outside the pcb_smtpad_116 clearance",
  (): void => {
    const fixture = loadSrj19Sample76ForceImproveInput()
    const solver = createSrj19Sample76ForceImproveSolver(fixture)

    expect(findSrj19Sample76ViaPadViolations(solver.getOutput())).toEqual([])
  },
)
