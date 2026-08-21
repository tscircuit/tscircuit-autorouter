#!/usr/bin/env bun

const datasetName = process.argv[2];

if (!datasetName) {
  console.error("Usage: bun scripts/benchmark/run-benchmark.ts <dataset-name>");
  console.error("Example: bun scripts/benchmark/run-benchmark.ts dataset01");
  process.exit(1);
}

async function runBenchmark() {
  try {
    const benchmarkModule = await import(
      `../benchmarks/${datasetName}/${datasetName}.ts`
    );

    const functionName = `run${datasetName.charAt(0).toUpperCase() + datasetName.slice(1)}Benchmark`;
    const benchmarkFunction = benchmarkModule[functionName];

    if (!benchmarkFunction) {
      console.error(
        `Benchmark function '${functionName}' not found in examples/benchmark/${datasetName}/${datasetName}.ts`,
      );
      process.exit(1);
    }

    const results = benchmarkFunction();

    const allPassed = results.every((r: any) => r.success);
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error(`Failed to load benchmark: ${error}`);
    process.exit(1);
  }
}

runBenchmark();
