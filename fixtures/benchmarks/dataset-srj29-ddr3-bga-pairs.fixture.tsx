import { dataset as datasetSrj29 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { SimpleRouteJson } from "lib/types"
import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const sampleKeyPattern = /^sample(\d{3})$/

const circuits = Object.entries(datasetSrj29)
  .map(([key, srj]) => {
    const sampleMatch = key.match(sampleKeyPattern)
    if (!sampleMatch) return null

    return {
      id: sampleMatch[1],
      srj: srj as SimpleRouteJson,
    }
  })
  .filter((circuit): circuit is DatasetCircuit => circuit !== null)
  .sort((a, b) => Number(a.id) - Number(b.id))

export default () => (
  <DatasetBenchmarkFixture
    datasetLabel="dataset-srj29-ddr3-bga-pairs"
    circuits={circuits}
    renderDebugger={(circuit) => (
      <GenericSolverDebugger
        key={`dataset-srj29-ddr3-bga-pairs-${circuit.id}`}
        createSolver={() =>
          new AutoroutingPipelineSolver10_BgaFanout(circuit.srj)
        }
      />
    )}
  />
)
