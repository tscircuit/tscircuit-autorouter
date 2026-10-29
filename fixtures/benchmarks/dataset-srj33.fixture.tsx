import * as datasetSrj33 from "@tscircuit/dataset-srj33-drc-failures"
import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const circuitKeyPattern = /^sample(\d{3})$/

const circuits = Object.entries(datasetSrj33)
  .map(([key, srj]) => {
    const circuitMatch = key.match(circuitKeyPattern)
    if (!circuitMatch) return null

    return {
      id: circuitMatch[1],
      srj: srj as DatasetCircuit["srj"],
    }
  })
  .filter((circuit): circuit is DatasetCircuit => circuit !== null)
  .sort((a, b) => Number(a.id) - Number(b.id))

export default () => (
  <DatasetBenchmarkFixture
    datasetLabel="dataset-srj33-drc-failures"
    circuits={circuits}
  />
)
