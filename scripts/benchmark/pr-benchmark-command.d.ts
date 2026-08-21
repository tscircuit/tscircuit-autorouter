export type PrBenchmarkCommand = {
  kind: "profile" | "benchmark" | "benchmark-long" | "benchmark-all";
  benchmarkArgs: string[];
  datasetName: string;
  profileSolvers: boolean;
  sameMachineCompare: boolean;
};

export function parsePrBenchmarkCommand(body: string): PrBenchmarkCommand;
