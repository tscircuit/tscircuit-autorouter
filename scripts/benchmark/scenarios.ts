import type { SimpleRouteJson } from "../../lib/types/srj-types"

export const DATASET_NAMES = [
  "dataset01",
  "zdwiel",
  "srj05",
  "srj11",
  "srj12",
] as const

export type DatasetName = (typeof DATASET_NAMES)[number]

type DatasetModule = Record<string, unknown>

export const DATASET_OPTIONS_LABEL =
  "1/dataset01, zdwiel, 5/srj05, 11/srj11, 12/srj12"

const datasetAliases: Record<string, DatasetName> = {
  "1": "dataset01",
  "01": "dataset01",
  dataset1: "dataset01",
  dataset01: "dataset01",
  "5": "srj05",
  "05": "srj05",
  srj5: "srj05",
  srj05: "srj05",
  "dataset-srj05": "srj05",
  "11": "srj11",
  srj11: "srj11",
  "dataset-srj11-45-degree": "srj11",
  "12": "srj12",
  srj12: "srj12",
  "dataset-srj12-bus-routing": "srj12",
  "@tsci/tscircuit.dataset-srj12-bus-routing": "srj12",
  zdwiel: "zdwiel",
}

export const parseDatasetName = (value: string): DatasetName | null => {
  const normalized = value.trim().toLowerCase()
  return datasetAliases[normalized] ?? null
}

export const isDatasetName = (value: string): value is DatasetName =>
  DATASET_NAMES.includes(value as DatasetName)

const loadNumberedJsonDatasetModule = async ({
  sampleCount,
  getSpecifier,
}: {
  sampleCount: number
  getSpecifier: (sampleId: string) => string
}): Promise<DatasetModule> => {
  const entries = await Promise.all(
    Array.from({ length: sampleCount }, async (_, index) => {
      const sampleId = String(index + 1).padStart(3, "0")
      return [
        `sample${sampleId}Circuit`,
        await import(getSpecifier(sampleId), { with: { type: "json" } }),
      ] as const
    }),
  )
  return Object.fromEntries(entries)
}

const datasetLoaders: Record<DatasetName, () => Promise<DatasetModule>> = {
  dataset01: async () =>
    (await import("@tscircuit/autorouting-dataset-01")) as DatasetModule,
  zdwiel: async () => (await import("zdwiel-dataset")) as DatasetModule,
  srj05: async () =>
    (await import("@tscircuit/dataset-srj05")) as DatasetModule,
  srj11: async () =>
    loadNumberedJsonDatasetModule({
      sampleCount: 20,
      getSpecifier: (sampleId) =>
        `dataset-srj11-45-degree/circuits/sample${sampleId}.circuit.simple-route.json`,
    }),
  srj12: async () =>
    loadNumberedJsonDatasetModule({
      sampleCount: 10,
      getSpecifier: (sampleId) =>
        `@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample${sampleId}/sample${sampleId}.circuit.simple-route.json`,
    }),
}

const datasetScenarioKeyPatterns: Record<DatasetName, RegExp> = {
  dataset01: /^circuit\d+$/,
  zdwiel: /^ts\d+_/,
  srj05: /^sample\d{3}.*Circuit$/,
  srj11: /^sample\d{3}Circuit$/,
  srj12: /^sample\d{3}Circuit$/,
}

export const toSimpleRouteJson = (value: unknown): SimpleRouteJson | null => {
  if (!value || typeof value !== "object") {
    return null
  }

  const asRecord = value as Record<string, unknown>
  const unwrappedValue =
    asRecord.default && typeof asRecord.default === "object"
      ? asRecord.default
      : value
  const unwrappedRecord = unwrappedValue as Record<string, unknown>
  const candidate =
    (unwrappedRecord.simpleRouteJson &&
      typeof unwrappedRecord.simpleRouteJson === "object" &&
      unwrappedRecord.simpleRouteJson) ||
    (unwrappedRecord.simple_route_json &&
      typeof unwrappedRecord.simple_route_json === "object" &&
      unwrappedRecord.simple_route_json) ||
    unwrappedValue

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
