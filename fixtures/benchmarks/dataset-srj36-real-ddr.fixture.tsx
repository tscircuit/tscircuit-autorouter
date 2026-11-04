import { dataset } from "@tscircuit/dataset-srj36-real-ddr"
import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const circuits = Object.entries(dataset).map(([name, srj]) => ({
  id: name.slice(6),
  srj: srj as DatasetCircuit["srj"],
}))

export default () => (
  <DatasetBenchmarkFixture
    datasetLabel="dataset-srj36-real-ddr"
    circuits={circuits}
  />
)
