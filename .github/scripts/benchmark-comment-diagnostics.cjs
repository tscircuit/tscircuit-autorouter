const refinementCountStatNames = [
  "physicalPortalGroupCount",
  "eligibleRouteCount",
  "routesConsidered",
  "candidateCount",
  "acceptedCandidateCount",
  "routesImproved",
  "predictedViaDemandBefore",
  "predictedViaDemandAfter",
  "entryExitLayerChangesBefore",
  "entryExitLayerChangesAfter",
  "rejectedForRegionCostCount",
  "rejectedForIntersectionRegressionCount",
  "rejectedForPortConflictCount",
  "rejectedForLockedAssignmentCount",
  "rejectedForNoViaDemandImprovementCount",
  "rejectedForNoEntryExitImprovementCount",
  "touchedRegionCount",
]

const refinementTimingStatNames = [
  "tinyHypergraphSolveMs",
  "tinyHypergraphSectionOptimizationMs",
  "portalLayerRefinementMs",
  "uniformPortDistributionMs",
  "highDensityRouteMs",
  "highDensityForceImproveMs",
  "highDensityRepairMs",
  "stitchingMs",
  "traceSimplificationMs",
  "traceWidthMs",
  "globalDrcMs",
  "exactDrcMs",
  "totalMs",
]

const getFiniteValues = (tests, statName) =>
  tests.flatMap((test) => {
    const value = test?.benchmarkStats?.[statName]
    return typeof value === "number" && Number.isFinite(value) ? [value] : []
  })

const sumValues = (values) => values.reduce((total, value) => total + value, 0)

const averageValues = (values) =>
  values.length > 0 ? sumValues(values) / values.length : null

const getRefinementCell = (test) => {
  const stats = test?.benchmarkStats
  if (!stats) return ""
  return `eligible=${stats.eligibleRouteCount ?? 0}; accepted=${stats.acceptedCandidateCount ?? 0}; predicted=${stats.predictedViaDemandBefore ?? 0}→${stats.predictedViaDemandAfter ?? 0}`
}

const renderRefinementSummary = ({ report, formatAverage, formatTime }) => {
  const tests = Array.isArray(report?.tests) ? report.tests : []
  if (!tests.some((test) => test?.benchmarkStats)) return []
  return [
    "### Portal-layer refinement diagnostics",
    "",
    "| Field | Total |",
    "| --- | ---: |",
    ...refinementCountStatNames.map(
      (statName) =>
        `| ${statName} | ${formatAverage(sumValues(getFiniteValues(tests, statName)))} |`,
    ),
    "",
    "| Timing field | Average |",
    "| --- | ---: |",
    ...refinementTimingStatNames.map(
      (statName) =>
        `| ${statName} | ${formatTime(averageValues(getFiniteValues(tests, statName)))} |`,
    ),
  ]
}

const renderPairedComparison = ({
  mainReport,
  prReport,
  buildMainIndex,
  formatAverage,
  formatTime,
}) => {
  if (!Array.isArray(mainReport?.tests) || !Array.isArray(prReport?.tests)) {
    return []
  }

  const mainIndex = buildMainIndex(mainReport)
  const classifications = {
    "baseline solved + PR solved": 0,
    "baseline solved + PR failed": 0,
    "baseline solved + PR timeout": 0,
    "baseline failed + PR solved": 0,
    "baseline timeout + PR solved": 0,
    "both failed": 0,
    "both timeout": 0,
    "other status transitions": 0,
    "unmatched PR samples": 0,
  }
  const pairedSolved = []

  for (const prTest of prReport.tests) {
    const mainTest = mainIndex.get(
      `${prTest.solverName}::${prTest.scenarioName}`,
    )
    if (!mainTest) {
      classifications["unmatched PR samples"] += 1
      continue
    }
    if (mainTest.didSolve && prTest.didSolve) {
      classifications["baseline solved + PR solved"] += 1
      pairedSolved.push({ mainTest, prTest })
    } else if (mainTest.didSolve && prTest.didTimeout) {
      classifications["baseline solved + PR timeout"] += 1
    } else if (mainTest.didSolve) {
      classifications["baseline solved + PR failed"] += 1
    } else if (mainTest.didTimeout && prTest.didSolve) {
      classifications["baseline timeout + PR solved"] += 1
    } else if (prTest.didSolve) {
      classifications["baseline failed + PR solved"] += 1
    } else if (mainTest.didTimeout && prTest.didTimeout) {
      classifications["both timeout"] += 1
    } else if (!mainTest.didTimeout && !prTest.didTimeout) {
      classifications["both failed"] += 1
    } else {
      classifications["other status transitions"] += 1
    }
  }

  const pairedMetric = (mainSelector, prSelector) => {
    const values = pairedSolved.flatMap(({ mainTest, prTest }) => {
      const mainValue = mainSelector(mainTest)
      const prValue = prSelector(prTest)
      return typeof mainValue === "number" &&
        Number.isFinite(mainValue) &&
        typeof prValue === "number" &&
        Number.isFinite(prValue)
        ? [{ mainValue, prValue }]
        : []
    })
    if (values.length === 0) return { main: null, pr: null, delta: null }
    const main = averageValues(values.map(({ mainValue }) => mainValue))
    const pr = averageValues(values.map(({ prValue }) => prValue))
    return { main, pr, delta: pr - main }
  }

  const finalVia = pairedMetric(
    (test) => test.viaCount,
    (test) => test.viaCount,
  )
  const drcErrors = pairedMetric(
    (test) => test.drcErrorCount,
    (test) => test.drcErrorCount,
  )
  const runtime = pairedMetric(
    (test) => test.elapsedTimeMs,
    (test) => test.elapsedTimeMs,
  )
  const highDensityVia = pairedMetric(
    (test) => test.highDensityViaCount,
    (test) => test.highDensityViaCount,
  )
  const acceptedCandidateCount = sumValues(
    getFiniteValues(prReport.tests, "acceptedCandidateCount"),
  )
  const predictedBefore = sumValues(
    getFiniteValues(prReport.tests, "predictedViaDemandBefore"),
  )
  const predictedAfter = sumValues(
    getFiniteValues(prReport.tests, "predictedViaDemandAfter"),
  )
  const formatDelta = (value) =>
    typeof value === "number" && Number.isFinite(value)
      ? `${value > 0 ? "+" : ""}${value.toFixed(2)}`
      : "n/a"

  return [
    "### Paired comparison",
    "",
    "| Classification | Count |",
    "| --- | ---: |",
    ...Object.entries(classifications).map(
      ([label, count]) => `| ${label} | ${count} |`,
    ),
    "",
    "| Paired solved metric | Baseline | PR | Delta |",
    "| --- | ---: | ---: | ---: |",
    `| final via count | ${formatAverage(finalVia.main)} | ${formatAverage(finalVia.pr)} | ${formatDelta(finalVia.delta)} |`,
    `| final relaxed DRC error count | ${formatAverage(drcErrors.main)} | ${formatAverage(drcErrors.pr)} | ${formatDelta(drcErrors.delta)} |`,
    `| runtime | ${formatTime(runtime.main)} | ${formatTime(runtime.pr)} | ${formatTime(runtime.delta)} |`,
    `| high-density via count | ${formatAverage(highDensityVia.main)} | ${formatAverage(highDensityVia.pr)} | ${formatDelta(highDensityVia.delta)} |`,
    "",
    `PR refinement acceptedCandidateCount: ${formatAverage(acceptedCandidateCount)}`,
    `PR predictedViaDemandBefore → predictedViaDemandAfter: ${formatAverage(predictedBefore)} → ${formatAverage(predictedAfter)} (${formatDelta(predictedAfter - predictedBefore)})`,
  ]
}

module.exports = {
  getRefinementCell,
  renderPairedComparison,
  renderRefinementSummary,
}
