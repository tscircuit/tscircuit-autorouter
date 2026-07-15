export type PrBenchmarkCommand = {
  kind: "benchmark" | "benchmark-all"
  benchmarkArgs: string[]
  datasetName: string
  profileSolvers: boolean
}

export function parsePrBenchmarkCommand(body: string): PrBenchmarkCommand
