import * as datasetSrj28 from "@tscircuit/dataset-srj28-partially-prerouted"
import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const circuitKeyPattern = /^circuit(\d{3})$/

const circuits = Object.entries(datasetSrj28)
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
  <DatasetBenchmarkFixture datasetLabel="dataset-srj28" circuits={circuits} />
)
