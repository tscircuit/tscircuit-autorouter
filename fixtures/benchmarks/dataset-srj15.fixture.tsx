import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const samplePathPattern = /\/sample(\d+)-region-reroute\.srj\.json$/

// @ts-ignore
const srjModules = import.meta.glob("../datasets/dataset-srj15/*.srj.json", {
  eager: true,
  import: "default",
}) as Record<string, DatasetCircuit["srj"]>

const circuits = Object.entries(srjModules)
  .map(([path, srj]) => {
    const sampleMatch = path.match(samplePathPattern)
    if (!sampleMatch) return null

    return {
      id: sampleMatch[1].padStart(3, "0"),
      srj,
    }
  })
  .filter((circuit): circuit is DatasetCircuit => circuit !== null)
  .sort((a, b) => Number(a.id) - Number(b.id))

export default () => (
  <DatasetBenchmarkFixture datasetLabel="dataset-srj15" circuits={circuits} />
)
