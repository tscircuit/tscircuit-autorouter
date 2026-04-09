import type { SimpleRouteJson } from "../../lib/types/srj-types"

export const DATASET_NAMES = ["dataset01", "zdwiel", "srj05"] as const

export type DatasetName = (typeof DATASET_NAMES)[number]

type DatasetModule = Record<string, unknown>

const datasetLoaders: Record<DatasetName, () => Promise<DatasetModule>> = {
  dataset01: async () =>
    (await import("@tscircuit/autorouting-dataset-01")) as DatasetModule,
  zdwiel: async () => (await import("zdwiel-dataset")) as DatasetModule,
  srj05: async () =>
    (await import("@tscircuit/dataset-srj05")) as DatasetModule,
}

const datasetScenarioKeyPatterns: Record<DatasetName, RegExp> = {
  dataset01: /^circuit\d+$/,
  zdwiel: /^ts\d+_/,
  srj05: /^sample\d{3}.*Circuit$/,
}

export const isDatasetName = (value: string): value is DatasetName =>
  DATASET_NAMES.includes(value as DatasetName)

export const toSimpleRouteJson = (value: unknown): SimpleRouteJson | null => {
  if (!value || typeof value !== "object") {
    return null
  }

  const asRecord = value as Record<string, unknown>
  const candidate =
    (asRecord.simpleRouteJson &&
      typeof asRecord.simpleRouteJson === "object" &&
      asRecord.simpleRouteJson) ||
    (asRecord.simple_route_json &&
      typeof asRecord.simple_route_json === "object" &&
      asRecord.simple_route_json) ||
    value

  if (!candidate || typeof candidate !== "object") {
    return null
  }

  return "bounds" in candidate ? (candidate as SimpleRouteJson) : null
}

export const loadScenarios = async (
  datasetName: DatasetName,
  opts: {
    scenarioLimit?: number
    effort?: number
  } = {},
) => {
  const applyEffortOverride = <T extends SimpleRouteJson>(
    scenario: T,
    effortOverride: number,
  ) =>
    ({
      ...scenario,
      effort: effortOverride,
    }) as T & { effort: number }

  const datasetModule = await datasetLoaders[datasetName]()
  const scenarioKeyPattern = datasetScenarioKeyPatterns[datasetName]
  const allScenarios = Object.entries(datasetModule)
    .map(([name, value]) => [name, toSimpleRouteJson(value)] as const)
    .filter((entry): entry is [string, SimpleRouteJson] => Boolean(entry[1]))
    .filter(([name]) => scenarioKeyPattern.test(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, scenario]) =>
        [
          name,
          opts.effort === undefined
            ? scenario
            : applyEffortOverride(scenario, opts.effort),
        ] as const,
    )

  return opts.scenarioLimit
    ? allScenarios.slice(0, opts.scenarioLimit)
    : allScenarios
}

export const loadScenarioBySampleNumber = async (
  datasetName: DatasetName,
  sampleNumber: number,
  effort?: number,
) => {
  if (!Number.isFinite(sampleNumber) || sampleNumber < 1) {
    throw new Error("--sample must be a positive integer")
  }

  const scenarios = await loadScenarios(datasetName, { effort })
  const scenario = scenarios[sampleNumber - 1]

  if (!scenario) {
    throw new Error(
      `Sample ${sampleNumber} is out of range for dataset ${datasetName} (${scenarios.length} samples)`,
    )
  }

  const [scenarioName, simpleRouteJson] = scenario
  return {
    scenarioName,
    scenario: simpleRouteJson,
    sampleNumber,
    totalSamples: scenarios.length,
    sourceLabel: `${datasetName}#${sampleNumber}:${scenarioName}`,
  }
}
