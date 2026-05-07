import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"
import * as datasetSrj16 from "@tsci/tscircuit.dataset-srj16-bga-breakouts"

const isSimpleRouteJson = (value: unknown): value is DatasetCircuit["srj"] => {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<DatasetCircuit["srj"]>
  return (
    typeof candidate.layerCount === "number" &&
    typeof candidate.minTraceWidth === "number" &&
    Array.isArray(candidate.obstacles) &&
    Array.isArray(candidate.connections) &&
    Boolean(candidate.bounds)
  )
}

const circuits = datasetSrj16.samples
  .map((sample): DatasetCircuit | null => {
    const sampleMatch = sample.sampleName.match(/^sample(\d{3})$/)
    if (!sampleMatch || !isSimpleRouteJson(sample.srj)) return null

    return {
      id: sampleMatch[1],
      srj: sample.srj,
    }
  })
  .filter((circuit): circuit is DatasetCircuit => circuit !== null)
  .sort((a, b) => Number(a.id) - Number(b.id))

export default () => (
  <DatasetBenchmarkFixture datasetLabel="dataset-srj16" circuits={circuits} />
)
