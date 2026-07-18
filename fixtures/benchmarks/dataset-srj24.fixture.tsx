import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"
import { dataset as datasetSrj24 } from "@tscircuit/dataset-srj24"

const sampleKeyPattern = /^sample(\d{3})$/

const circuits = Object.entries(datasetSrj24)
  .map(([key, srj]) => {
    const sampleMatch = key.match(sampleKeyPattern)
    if (!sampleMatch) return null

    return {
      id: sampleMatch[1],
      srj,
    }
  })
  .filter((circuit): circuit is DatasetCircuit => circuit !== null)
  .sort((a, b) => Number(a.id) - Number(b.id))

export default () => (
  <DatasetBenchmarkFixture datasetLabel="dataset-srj24" circuits={circuits} />
)
