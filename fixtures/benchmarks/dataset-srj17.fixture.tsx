import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"
import sample001 from "../../tests/features/tracewidthsolver/assets/example001.json"

const circuits = [{ id: "001", srj: sample001 }] satisfies DatasetCircuit[]

export default () => (
  <DatasetBenchmarkFixture
    datasetLabel="dataset-srj11-45-degree"
    circuits={circuits}
  />
)
