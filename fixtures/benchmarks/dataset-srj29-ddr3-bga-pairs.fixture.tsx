import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { SimpleRouteJson } from "lib/types"
import { useEffect, useState } from "react"
import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const samplePathPattern = /\/sample(\d{3})\.json$/

const sampleUrlModules = import.meta.glob(
  "../../node_modules/@tscircuit/dataset-srj29-ddr3-bga-pairs/samples/sample*.json",
  { import: "default", query: "?url" },
) as Record<string, () => Promise<string>>

type DatasetLoadState =
  | { status: "loading" }
  | { status: "ready"; circuits: DatasetCircuit[] }
  | { status: "error"; message: string }

const loadSample = async (
  loadSampleUrl: () => Promise<string>,
): Promise<SimpleRouteJson> => {
  const sampleUrl = await loadSampleUrl()
  const response = await fetch(sampleUrl)
  if (!response.ok) {
    throw new Error(`Failed to load ${sampleUrl}: ${response.status}`)
  }
  return (await response.json()) as SimpleRouteJson
}

const loadCircuits = async (): Promise<DatasetCircuit[]> => {
  const circuits = await Promise.all(
    Object.entries(sampleUrlModules).map(async ([path, loadSampleUrl]) => {
      const sampleMatch = path.match(samplePathPattern)
      if (!sampleMatch) return null

      return {
        id: sampleMatch[1],
        srj: await loadSample(loadSampleUrl),
      }
    }),
  )

  return circuits
    .filter((circuit): circuit is DatasetCircuit => circuit !== null)
    .sort((a, b) => Number(a.id) - Number(b.id))
}

export default () => {
  const [loadState, setLoadState] = useState<DatasetLoadState>({
    status: "loading",
  })

  useEffect(() => {
    let isMounted = true

    const loadDataset = async (): Promise<void> => {
      try {
        const circuits = await loadCircuits()
        if (!isMounted) return

        setLoadState({
          status: "ready",
          circuits,
        })
      } catch (error) {
        if (!isMounted) return

        setLoadState({
          status: "error",
          message: `Failed to load dataset: ${(error as Error).message}`,
        })
      }
    }

    void loadDataset()

    return () => {
      isMounted = false
    }
  }, [])

  if (loadState.status === "loading") {
    return <div>Loading dataset...</div>
  }

  if (loadState.status === "error") {
    return <div style={{ color: "red" }}>{loadState.message}</div>
  }

  return (
    <DatasetBenchmarkFixture
      datasetLabel="dataset-srj29-ddr3-bga-pairs"
      circuits={loadState.circuits}
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
}
