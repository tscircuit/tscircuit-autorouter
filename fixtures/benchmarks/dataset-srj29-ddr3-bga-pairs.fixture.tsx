import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { SimpleRouteJson } from "lib/types"
import { useEffect, useState } from "react"
import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const sampleKeyPattern = /^sample(\d{3})$/

type DatasetLoadState =
  | { status: "loading" }
  | { status: "ready"; circuits: DatasetCircuit[] }
  | { status: "error"; message: string }

const indexDataset = (
  datasetModule: Record<string, unknown>,
): DatasetCircuit[] =>
  Object.entries(datasetModule)
    .map(([key, srj]) => {
      const sampleMatch = key.match(sampleKeyPattern)
      if (!sampleMatch) return null

      return {
        id: sampleMatch[1],
        srj: srj as SimpleRouteJson,
      }
    })
    .filter((circuit): circuit is DatasetCircuit => circuit !== null)
    .sort((a, b) => Number(a.id) - Number(b.id))

export default () => {
  const [loadState, setLoadState] = useState<DatasetLoadState>({
    status: "loading",
  })

  useEffect(() => {
    let isMounted = true

    const loadDataset = async (): Promise<void> => {
      try {
        const datasetModule = await import(
          "@tscircuit/dataset-srj29-ddr3-bga-pairs"
        )
        if (!isMounted) return

        setLoadState({
          status: "ready",
          circuits: indexDataset(datasetModule),
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
