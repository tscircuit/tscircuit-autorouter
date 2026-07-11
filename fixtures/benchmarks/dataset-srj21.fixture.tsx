import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"
import * as datasetSrj21 from "@tsci/0hmX.multi-component-dataset-srj01"

const circuitKeyPattern = /^circuit(\d{3})$/

const circuits = Object.entries(datasetSrj21)
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
  <DatasetBenchmarkFixture datasetLabel="dataset-srj21" circuits={circuits} />
)
