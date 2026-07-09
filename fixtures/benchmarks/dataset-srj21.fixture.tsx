import * as datasetSrj21 from "@tsci/0hmX.multi-component-dataset-srj01"
import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

type DatasetModuleEntry = [string, unknown]

const circuitKeyPattern = /^circuit(\d{3})$/

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

const circuits = (Object.entries(datasetSrj21) as DatasetModuleEntry[])
  .map(([key, srj]): DatasetCircuit | null => {
    const circuitMatch = key.match(circuitKeyPattern)
    if (!circuitMatch || !isSimpleRouteJson(srj)) return null

    return {
      id: circuitMatch[1],
      srj,
    }
  })
  .filter((circuit): circuit is DatasetCircuit => circuit !== null)
  .sort((a, b) => Number(a.id) - Number(b.id))

export default () => (
  <DatasetBenchmarkFixture datasetLabel="dataset-srj21" circuits={circuits} />
)
