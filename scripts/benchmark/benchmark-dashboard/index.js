let dashboardData
const runById = new Map()
const runRequests = new Map()
const datasetSelect = getRequiredElement("dataset")
const solverSelect = getRequiredElement("solver")
const effortSelect = getRequiredElement("effort")
const sampleSelect = getRequiredElement("sample")
const rangeSelect = getRequiredElement("range")
const chart = getRequiredElement("chart")
const chartTooltip = getRequiredElement("chart-tooltip")
const samplesTable = getRequiredElement("samples")
const recentRunsTable = getRequiredElement("recent-runs")
const sampleStatusSelect = getRequiredElement("sample-status")
const sampleSearchInput = getRequiredElement("sample-search")
const initialHash = new URLSearchParams(location.hash.slice(1))
const chartColor = "#67e8c1"
const metricDefinitions = [
  {
    key: "completedRate",
    label: "Completion",
    group: "Reliability",
    unit: "%",
    direction: "higher",
  },
  {
    key: "relaxedDrcRate",
    label: "Relaxed DRC",
    group: "Reliability",
    unit: "%",
    direction: "higher",
  },
  {
    key: "p50TimeMs",
    label: "P50",
    group: "Solve time",
    unit: "ms",
    direction: "lower",
  },
  {
    key: "p90TimeMs",
    label: "P90",
    group: "Solve time",
    unit: "ms",
    direction: "lower",
  },
  {
    key: "p95TimeMs",
    label: "P95",
    group: "Solve time",
    unit: "ms",
    direction: "lower",
  },
  {
    key: "maxTimeMs",
    label: "Maximum",
    group: "Solve time",
    unit: "ms",
    direction: "lower",
  },
  {
    key: "avgVia",
    label: "Average",
    group: "Vias",
    unit: "vias",
    direction: "lower",
  },
  {
    key: "medianVia",
    label: "Median",
    group: "Vias",
    unit: "vias",
    direction: "lower",
  },
  {
    key: "maxVia",
    label: "Maximum",
    group: "Vias",
    unit: "vias",
    direction: "lower",
  },
]
const metricByKey = new Map(
  metricDefinitions.map((metric) => [metric.key, metric]),
)
const dashboardState = {
  metricKey: metricByKey.has(initialHash.get("metric"))
    ? initialHash.get("metric")
    : "completedRate",
  selectedRunId: initialHash.get("run"),
  sampleSortKey: "sampleNumber",
  sampleSortDirection: "asc",
}

function getRequiredElement(id) {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error("Benchmark dashboard element #" + id + " is missing")
  }
  return element
}

function escapeHtml(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }
  return String(value).replace(
    /[&<>"']/g,
    (character) => replacements[character],
  )
}

function uniqueSorted(values) {
  const uniqueValues = [...new Set(values)]
  const sortedValues = uniqueValues.sort((left, right) =>
    String(left).localeCompare(String(right)),
  )
  return sortedValues
}

function setSelectOptions(select, values, preferredValue, labelForValue) {
  select.innerHTML = values
    .map(
      (value) =>
        '<option value="' +
        escapeHtml(value) +
        '">' +
        escapeHtml(labelForValue ? labelForValue(value) : value) +
        "</option>",
    )
    .join("")
  if (preferredValue !== null && values.includes(preferredValue)) {
    select.value = preferredValue
  }
}

async function loadRun(runId) {
  const existingRequest = runRequests.get(runId)
  if (existingRequest) return existingRequest
  const run = runById.get(runId)
  if (!run)
    throw new Error(
      "Benchmark run " + runId + " is missing from the dashboard index",
    )
  const request = fetch(new URL("./data/" + run.path, location.href))
    .then((response) => {
      if (!response.ok)
        throw new Error(
          "Could not load benchmark run " + runId + ": HTTP " + response.status,
        )
      return response.json()
    })
    .then((loadedRun) => {
      if (!loadedRun || loadedRun.runId !== runId) {
        throw new Error(
          "Benchmark run data does not match requested run " + runId,
        )
      }
      return loadedRun
    })
  runRequests.set(runId, request)
  return request
}

function getRunReports(run) {
  if (run.report.version === 2) {
    return run.report.reports
  }
  if (run.report.version === 1) {
    return [run.report]
  }
  throw new Error(
    "Benchmark run " + run.runId + " has an unsupported report version",
  )
}

async function getPointSamples(point) {
  const run = await loadRun(point.runId)
  const report = getRunReports(run).find(
    (item) =>
      item.datasetName === point.datasetName &&
      item.effortLabel === point.effortLabel,
  )
  if (!report)
    throw new Error("Benchmark report for " + point.datasetName + " is missing")
  return report.tests
    .filter((sample) => sample.solverName === point.solverName)
    .map((sample) => {
      if (sample.sampleNumber !== undefined) return sample
      const numberMatches = sample.scenarioName.match(/\d+/g)
      if (!numberMatches || numberMatches.length !== 1) {
        throw new Error(
          "Could not derive sample number from " + sample.scenarioName,
        )
      }
      return { ...sample, sampleNumber: Number.parseInt(numberMatches[0], 10) }
    })
}

function formatDate(value, includeTime) {
  const options = includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { month: "short", day: "numeric" }
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value))
}

function formatDuration(value) {
  if (value === null || value === undefined) return "n/a"
  if (!Number.isFinite(value))
    throw new Error("Cannot format a non-finite duration")
  if (Math.abs(value) >= 1000) return (value / 1000).toFixed(2) + " s"
  return value.toFixed(value < 100 ? 1 : 0) + " ms"
}

function formatMetricValue(metric, value) {
  if (value === null || value === undefined) return "n/a"
  if (!Number.isFinite(value))
    throw new Error("Cannot format a non-finite metric")
  if (metric.unit === "%") return value.toFixed(1) + " %"
  if (metric.unit === "ms") return formatDuration(value)
  return value.toFixed(1) + " vias"
}

function formatMetricDelta(metric, delta) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) {
    return "No previous value"
  }
  const prefix = delta > 0 ? "+" : ""
  if (metric.unit === "%") return prefix + delta.toFixed(1) + " pp"
  if (metric.unit === "ms") return prefix + formatDuration(delta)
  return prefix + delta.toFixed(1) + " vias"
}

function getDeltaTone(metric, delta) {
  if (delta === null || delta === undefined || Math.abs(delta) < 0.0001) {
    return "neutral"
  }
  const improved = metric.direction === "higher" ? delta > 0 : delta < 0
  return improved ? "good" : "bad"
}

function formatStatus(sample) {
  if (sample.didTimeout) {
    return "Timeout"
  }
  if (sample.didSolve) {
    return "Solved"
  }
  return "Failed"
}

function getBaseSeriesPoints() {
  return dashboardData.points.filter(
    (point) =>
      point.datasetName === datasetSelect.value &&
      point.solverName === solverSelect.value &&
      point.effortLabel === effortSelect.value,
  )
}

async function getScopedSeriesPoints() {
  const selectedSampleNumber =
    sampleSelect.value === "" ? null : Number(sampleSelect.value)
  if (selectedSampleNumber === null) return getBaseSeriesPoints()
  if (!Number.isInteger(selectedSampleNumber)) {
    throw new Error("Selected sample number is invalid")
  }
  const points = await Promise.all(
    getBaseSeriesPoints().map(async (point) => {
      const samples = await getPointSamples(point)
      const sample = samples.find(
        (item) => item.sampleNumber === selectedSampleNumber,
      )
      if (!sample) return null
      return {
        ...point,
        completedRate: sample.didSolve ? 100 : 0,
        relaxedDrcRate: sample.relaxedDrcPassed ? 100 : 0,
        p50TimeMs: sample.elapsedTimeMs,
        p90TimeMs: sample.elapsedTimeMs,
        p95TimeMs: sample.elapsedTimeMs,
        maxTimeMs: sample.elapsedTimeMs,
        avgVia: sample.viaCount ?? null,
        medianVia: sample.viaCount ?? null,
        maxVia: sample.viaCount ?? null,
        samples: [sample],
      }
    }),
  )
  return points.filter((point) => point !== null)
}

async function getVisiblePoints() {
  const range = Number(rangeSelect.value)
  if (![20, 50, 100].includes(range)) {
    throw new Error("Selected benchmark range is invalid")
  }
  return (await getScopedSeriesPoints()).slice(-range)
}

async function getPreviousPoint(point) {
  const points = await getScopedSeriesPoints()
  const pointIndex = points.findIndex((item) => item.runId === point.runId)
  return pointIndex > 0 ? points[pointIndex - 1] : null
}

async function getSelectedPoint() {
  const points = await getVisiblePoints()
  const selectedPoint = points.find(
    (point) => point.runId === dashboardState.selectedRunId,
  )
  return selectedPoint ?? points[points.length - 1] ?? null
}

function renderHeader() {
  const latestRun = dashboardData.runs[dashboardData.runs.length - 1]
  const latestRunLink = getRequiredElement("latest-run-link")
  if (latestRun) {
    latestRunLink.href = latestRun.runUrl
    latestRunLink.textContent = "Latest workflow #" + latestRun.runId
  } else {
    latestRunLink.hidden = true
  }
  const datasets = new Set(
    dashboardData.points.map((point) => point.datasetName),
  )
  getRequiredElement("header-facts").innerHTML =
    '<span class="fact"><strong>' +
    dashboardData.runs.length +
    "</strong> stored runs</span>" +
    '<span class="fact"><strong>' +
    Math.min(dashboardData.dashboardRunLimit, dashboardData.runs.length) +
    '</strong> runs charted</span><span class="fact"><strong>' +
    datasets.size +
    "</strong> datasets</span>" +
    (latestRun
      ? '<span class="fact">Updated <strong>' +
        escapeHtml(formatDate(latestRun.createdAt, true)) +
        "</strong></span>"
      : "")
}

async function renderHealth() {
  const points = await getScopedSeriesPoints()
  const latest = points[points.length - 1]
  const previous = points[points.length - 2]
  const healthGrid = getRequiredElement("health-grid")
  const healthContext = getRequiredElement("health-context")
  if (!latest) {
    healthGrid.innerHTML =
      '<div class="empty-card">No benchmark data matches these filters.</div>'
    healthContext.textContent = ""
    return
  }
  healthContext.textContent =
    latest.datasetName +
    " · " +
    latest.solverName +
    " · " +
    latest.effortLabel +
    " · latest " +
    formatDate(latest.createdAt, true)
  const healthMetricKeys =
    sampleSelect.value === ""
      ? ["completedRate", "relaxedDrcRate", "p50TimeMs", "p95TimeMs", "avgVia"]
      : ["completedRate", "relaxedDrcRate", "p50TimeMs", "avgVia"]
  healthGrid.innerHTML = healthMetricKeys
    .map((metricKey) => {
      const metric = metricByKey.get(metricKey)
      const label =
        sampleSelect.value !== "" && metricKey === "p50TimeMs"
          ? "Elapsed time"
          : metric.label +
            (metric.group === "Solve time"
              ? " solve time"
              : metric.group === "Vias"
                ? " vias"
                : "")
      const delta =
        previous && latest[metricKey] !== null && previous[metricKey] !== null
          ? latest[metricKey] - previous[metricKey]
          : null
      const tone = getDeltaTone(metric, delta)
      return (
        '<article class="health-card" data-tone="' +
        tone +
        '"><span class="health-label">' +
        escapeHtml(label) +
        '</span><div class="health-value">' +
        escapeHtml(formatMetricValue(metric, latest[metricKey])) +
        '</div><span class="delta ' +
        tone +
        '">' +
        escapeHtml(formatMetricDelta(metric, delta)) +
        " vs previous</span></article>"
      )
    })
    .join("")
}

function renderMetricToolbar() {
  const sampleScoped = sampleSelect.value !== ""
  const availableMetrics = sampleScoped
    ? metricDefinitions.filter((metric) =>
        ["completedRate", "relaxedDrcRate", "p50TimeMs", "avgVia"].includes(
          metric.key,
        ),
      )
    : metricDefinitions
  if (
    !availableMetrics.some((metric) => metric.key === dashboardState.metricKey)
  ) {
    dashboardState.metricKey = "p50TimeMs"
  }
  const groups = uniqueSorted(availableMetrics.map((metric) => metric.group))
  getRequiredElement("metric-toolbar").innerHTML = groups
    .map((group) => {
      const buttons = availableMetrics
        .filter((metric) => metric.group === group)
        .map((metric) => {
          const label =
            sampleScoped && metric.key === "p50TimeMs"
              ? "Elapsed time"
              : sampleScoped && metric.key === "avgVia"
                ? "Via count"
                : metric.label
          return (
            '<button class="metric-button" type="button" data-metric="' +
            metric.key +
            '" aria-pressed="' +
            String(metric.key === dashboardState.metricKey) +
            '">' +
            escapeHtml(label) +
            "</button>"
          )
        })
        .join("")
      return (
        '<div class="metric-group"><span class="metric-group-label">' +
        escapeHtml(group) +
        "</span>" +
        buttons +
        "</div>"
      )
    })
    .join("")
}

function getAxisScale(metric, maximum) {
  if (metric.unit === "%") return { divisor: 1, unit: "%", maximum: 100 }
  if (metric.unit === "ms" && maximum >= 1000) {
    return { divisor: 1000, unit: "s", maximum: Math.max(maximum * 1.08, 1) }
  }
  return { divisor: 1, unit: metric.unit, maximum: Math.max(maximum * 1.08, 1) }
}

function formatAxisTick(value, scale) {
  const scaled = value / scale.divisor
  const decimals =
    scale.unit === "%" || scale.unit === "vias" ? 1 : scaled < 10 ? 2 : 0
  return scaled.toFixed(decimals) + " " + scale.unit
}

function makeSvgElement(name, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name)
  for (const [attributeName, value] of Object.entries(attributes)) {
    element.setAttribute(attributeName, String(value))
  }
  return element
}

function appendChartTitle(metric, points) {
  const title = makeSvgElement("title", { id: "chart-title" })
  title.textContent = metric.label + " history for " + datasetSelect.value
  const description = makeSvgElement("desc", { id: "chart-description" })
  description.textContent =
    points.length +
    " benchmark runs. Use Tab to focus data points and arrow keys to move between them."
  chart.append(title, description)
}

function renderEmptyChart(message) {
  const label = makeSvgElement("text", {
    x: 600,
    y: 215,
    fill: "currentColor",
    "text-anchor": "middle",
    "font-size": 16,
    opacity: 0.7,
  })
  label.textContent = message
  chart.append(label)
  getRequiredElement("chart-summary").textContent = "No chartable values"
  getRequiredElement("chart-unit").textContent = ""
}

async function showTooltip(point, metric, anchor) {
  const previous = await getPreviousPoint(point)
  const delta =
    previous && point[metric.key] !== null && previous[metric.key] !== null
      ? point[metric.key] - previous[metric.key]
      : null
  chartTooltip.innerHTML =
    '<div class="tooltip-value">' +
    escapeHtml(formatMetricValue(metric, point[metric.key])) +
    '</div><div class="tooltip-meta">' +
    escapeHtml(formatMetricDelta(metric, delta)) +
    " vs previous<br>" +
    escapeHtml(formatDate(point.createdAt, true)) +
    "<br>Workflow #" +
    escapeHtml(point.runId) +
    "</div>"
  chartTooltip.hidden = false
  const containerBounds = chartTooltip.parentElement.getBoundingClientRect()
  const anchorBounds = anchor.getBoundingClientRect()
  const desiredLeft =
    anchorBounds.left + anchorBounds.width / 2 - containerBounds.left - 105
  const desiredTop =
    anchorBounds.top - containerBounds.top - chartTooltip.offsetHeight - 12
  chartTooltip.style.left =
    Math.max(8, Math.min(desiredLeft, containerBounds.width - 226)) + "px"
  chartTooltip.style.top = Math.max(8, desiredTop) + "px"
}

function moveChartFocus(event, pointIndex) {
  const pointControls = [...chart.querySelectorAll(".point-hit")]
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault()
    const offset = event.key === "ArrowRight" ? 1 : -1
    const nextIndex = Math.max(
      0,
      Math.min(pointControls.length - 1, pointIndex + offset),
    )
    pointControls[nextIndex]?.focus()
  }
}

async function renderChart() {
  const points = await getVisiblePoints()
  const metric = metricByKey.get(dashboardState.metricKey)
  if (!metric) throw new Error("Selected benchmark metric is invalid")
  chart.innerHTML = ""
  chartTooltip.hidden = true
  appendChartTitle(metric, points)
  if (points.length === 0) {
    renderEmptyChart("No runs match the selected filters.")
    return
  }
  const values = points
    .map((point) => point[metric.key])
    .filter((value) => typeof value === "number" && Number.isFinite(value))
  if (values.length === 0) {
    renderEmptyChart(
      "No " +
        metric.label.toLowerCase() +
        " data is available for this series.",
    )
    return
  }
  const maximum = Math.max(...values)
  const scale = getAxisScale(metric, maximum)
  const plot = { left: 88, right: 1172, top: 28, bottom: 370 }
  const plotWidth = plot.right - plot.left
  const plotHeight = plot.bottom - plot.top
  for (let row = 0; row < 5; row++) {
    const y = plot.top + (plotHeight * row) / 4
    const value = scale.maximum - (scale.maximum * row) / 4
    chart.append(
      makeSvgElement("line", {
        x1: plot.left,
        y1: y,
        x2: plot.right,
        y2: y,
        stroke: "var(--border)",
      }),
    )
    const label = makeSvgElement("text", {
      x: plot.left - 12,
      y: y + 4,
      fill: "var(--muted)",
      "font-size": 11,
      "text-anchor": "end",
    })
    label.textContent = formatAxisTick(value, scale)
    chart.append(label)
  }
  const xTickIndexes = uniqueSorted([
    0,
    Math.floor((points.length - 1) / 4),
    Math.floor((points.length - 1) / 2),
    Math.floor(((points.length - 1) * 3) / 4),
    points.length - 1,
  ]).map(Number)
  for (const pointIndex of xTickIndexes) {
    const position =
      points.length === 1 ? 0.5 : pointIndex / (points.length - 1)
    const x = plot.left + plotWidth * position
    const label = makeSvgElement("text", {
      x,
      y: 403,
      fill: "var(--muted)",
      "font-size": 11,
      "text-anchor":
        pointIndex === 0
          ? "start"
          : pointIndex === points.length - 1
            ? "end"
            : "middle",
    })
    label.textContent = formatDate(points[pointIndex].createdAt, false)
    chart.append(label)
  }
  let segment = []
  const flushSegment = () => {
    if (segment.length > 1) {
      chart.append(
        makeSvgElement("polyline", {
          points: segment.join(" "),
          fill: "none",
          stroke: chartColor,
          "stroke-width": 3,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "pointer-events": "none",
        }),
      )
    }
    segment = []
  }
  const plottedPoints = []
  points.forEach((point, pointIndex) => {
    const value = point[metric.key]
    if (typeof value !== "number" || !Number.isFinite(value)) {
      flushSegment()
      return
    }
    const position =
      points.length === 1 ? 0.5 : pointIndex / (points.length - 1)
    const x = plot.left + plotWidth * position
    const y = plot.bottom - (value / scale.maximum) * plotHeight
    segment.push(x + "," + y)
    plottedPoints.push({ point, x, y })
  })
  flushSegment()
  const selectedPoint = await getSelectedPoint()
  const selectedPlot = plottedPoints.find(
    (item) => selectedPoint && item.point.runId === selectedPoint.runId,
  )
  if (selectedPlot) {
    chart.append(
      makeSvgElement("line", {
        x1: selectedPlot.x,
        y1: plot.top,
        x2: selectedPlot.x,
        y2: plot.bottom,
        stroke: "var(--blue)",
        "stroke-width": 1,
        "stroke-dasharray": "4 5",
        opacity: 0.55,
      }),
    )
  }
  plottedPoints.forEach(({ point, x, y }, pointIndex) => {
    const hitTarget = makeSvgElement("circle", {
      class: "point-hit",
      cx: x,
      cy: y,
      r: 14,
      tabindex: 0,
      role: "button",
      "aria-label":
        formatDate(point.createdAt, true) +
        ", " +
        formatMetricValue(metric, point[metric.key]) +
        ", workflow " +
        point.runId,
    })
    const visiblePoint = makeSvgElement("circle", {
      class: "point-visible",
      cx: x,
      cy: y,
      r: selectedPoint && point.runId === selectedPoint.runId ? 6 : 4,
      fill:
        selectedPoint && point.runId === selectedPoint.runId
          ? "var(--blue)"
          : chartColor,
      stroke: "var(--panel-soft)",
      "stroke-width": 2,
    })
    hitTarget.addEventListener("mouseenter", () => {
      void showTooltip(point, metric, visiblePoint)
    })
    hitTarget.addEventListener("mouseleave", () => {
      chartTooltip.hidden = true
    })
    hitTarget.addEventListener("focus", () => {
      void showTooltip(point, metric, visiblePoint)
    })
    hitTarget.addEventListener("blur", () => {
      chartTooltip.hidden = true
    })
    hitTarget.addEventListener("click", () =>
      runDashboardTask(selectPoint(point)),
    )
    hitTarget.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        runDashboardTask(selectPoint(point))
      } else {
        moveChartFocus(event, pointIndex)
      }
    })
    chart.append(hitTarget, visiblePoint)
  })
  getRequiredElement("chart-summary").textContent =
    points.length +
    " runs · " +
    formatDate(points[0].createdAt, false) +
    " – " +
    formatDate(points[points.length - 1].createdAt, false)
  const scopeLabel =
    sampleSelect.value === "" ? "All samples" : "Sample " + sampleSelect.value
  getRequiredElement("chart-unit").textContent =
    metric.label + " · " + scopeLabel + " · axis in " + scale.unit
}

function getSampleSortValue(sample, key) {
  if (key === "status") return formatStatus(sample)
  if (key === "drc") return sample.relaxedDrcPassed ? 1 : 0
  if (key === "vias") return sample.viaCount ?? Number.POSITIVE_INFINITY
  return sample[key] ?? ""
}

function getFilteredSortedSamples(point) {
  const query = sampleSearchInput.value.trim().toLowerCase()
  const status = sampleStatusSelect.value
  return [...point.samples]
    .filter((sample) => {
      const sampleStatus = formatStatus(sample).toLowerCase()
      const matchesStatus =
        status === "all" ||
        (status === "issues" &&
          (!sample.didSolve ||
            sample.didTimeout ||
            !sample.relaxedDrcPassed)) ||
        (status === "solved" && sample.didSolve) ||
        (status === "failed" && !sample.didSolve && !sample.didTimeout) ||
        (status === "timeout" && sample.didTimeout)
      const searchable = [
        sample.scenarioName,
        sample.errorPhaseName,
        sample.error,
        sample.sampleNumber,
        sampleStatus,
      ]
        .join(" ")
        .toLowerCase()
      return matchesStatus && searchable.includes(query)
    })
    .sort((left, right) => {
      const leftValue = getSampleSortValue(left, dashboardState.sampleSortKey)
      const rightValue = getSampleSortValue(right, dashboardState.sampleSortKey)
      const direction = dashboardState.sampleSortDirection === "asc" ? 1 : -1
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction
      }
      return String(leftValue).localeCompare(String(rightValue)) * direction
    })
}

function renderDeltaText(metric, currentValue, previousValue) {
  if (previousValue === null || previousValue === undefined) return ""
  const delta = currentValue - previousValue
  const tone = getDeltaTone(metric, delta)
  return (
    '<span class="cell-delta delta ' +
    tone +
    '">' +
    escapeHtml(formatMetricDelta(metric, delta)) +
    "</span>"
  )
}

function renderError(sample) {
  const phase = sample.errorPhaseName
    ? "<strong>" + escapeHtml(sample.errorPhaseName) + "</strong>"
    : ""
  if (!sample.error) return phase || '<span class="muted">—</span>'
  return (
    phase +
    (phase ? "<br>" : "") +
    "<details><summary>Error details</summary>" +
    escapeHtml(sample.error) +
    "</details>"
  )
}

function renderSamples(point, previous) {
  const samples = getFilteredSortedSamples(point)
  const previousByNumber = new Map(
    (previous?.samples ?? []).map((sample) => [sample.sampleNumber, sample]),
  )
  const directionMark =
    dashboardState.sampleSortDirection === "asc" ? " ↑" : " ↓"
  const header = (label, key) =>
    '<button class="sort-button" type="button" data-sort="' +
    key +
    '">' +
    label +
    (dashboardState.sampleSortKey === key ? directionMark : "") +
    "</button>"
  const rows = samples.map((sample) => {
    const previousSample = previousByNumber.get(sample.sampleNumber)
    const status = formatStatus(sample)
    const statusClass = status.toLowerCase()
    const previousStatus = previousSample ? formatStatus(previousSample) : null
    const statusDelta =
      previousStatus && previousStatus !== status
        ? '<span class="cell-delta delta bad">was ' +
          escapeHtml(previousStatus) +
          "</span>"
        : ""
    const drcStatus = sample.relaxedDrcPassed ? "Passed" : "Failed"
    const previousDrc = previousSample
      ? previousSample.relaxedDrcPassed
        ? "Passed"
        : "Failed"
      : null
    const drcDelta =
      previousDrc && previousDrc !== drcStatus
        ? '<span class="cell-delta delta ' +
          (sample.relaxedDrcPassed ? "good" : "bad") +
          '">was ' +
          previousDrc +
          "</span>"
        : ""
    return (
      '<tr><td class="scenario-cell">' +
      escapeHtml(sample.scenarioName) +
      "<small>Sample " +
      sample.sampleNumber +
      '</small></td><td><span class="badge ' +
      statusClass +
      '">' +
      status +
      "</span>" +
      statusDelta +
      '</td><td class="number-cell">' +
      escapeHtml(formatDuration(sample.elapsedTimeMs)) +
      renderDeltaText(
        metricByKey.get("p50TimeMs"),
        sample.elapsedTimeMs,
        previousSample?.elapsedTimeMs,
      ) +
      '</td><td><span class="badge ' +
      (sample.relaxedDrcPassed ? "passed" : "failed") +
      '">' +
      drcStatus +
      "</span>" +
      drcDelta +
      '</td><td class="number-cell">' +
      (sample.viaCount === undefined ? "n/a" : sample.viaCount + " vias") +
      (sample.viaCount !== undefined && previousSample?.viaCount !== undefined
        ? renderDeltaText(
            metricByKey.get("avgVia"),
            sample.viaCount,
            previousSample.viaCount,
          )
        : "") +
      '</td><td class="error-cell">' +
      renderError(sample) +
      "</td></tr>"
    )
  })
  samplesTable.innerHTML =
    "<caption>Samples for the selected benchmark run, compared with the previous comparable run</caption>" +
    "<thead><tr><th>" +
    header("Scenario", "scenarioName") +
    "</th><th>" +
    header("Status", "status") +
    "</th><th>" +
    header("Solve time", "elapsedTimeMs") +
    "</th><th>" +
    header("DRC", "drc") +
    "</th><th>" +
    header("Vias", "vias") +
    "</th><th>Error</th></tr></thead><tbody>" +
    rows.join("") +
    "</tbody>"
  getRequiredElement("sample-result-count").textContent =
    samples.length + " of " + point.samples.length + " samples"
  samplesTable.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      if (dashboardState.sampleSortKey === button.dataset.sort) {
        dashboardState.sampleSortDirection =
          dashboardState.sampleSortDirection === "asc" ? "desc" : "asc"
      } else {
        dashboardState.sampleSortKey = button.dataset.sort
        dashboardState.sampleSortDirection = "asc"
      }
      renderSamples(point, previous)
    })
  })
}

async function renderRunDetails() {
  const point = await getSelectedPoint()
  const runMeta = getRequiredElement("run-meta")
  if (!point) {
    dashboardState.selectedRunId = null
    getRequiredElement("selected-context").textContent =
      "No run matches the selected filters."
    runMeta.innerHTML = ""
    getRequiredElement("selected-metrics").innerHTML = ""
    samplesTable.innerHTML =
      '<tbody><tr><td class="muted">No samples to display.</td></tr></tbody>'
    return
  }
  dashboardState.selectedRunId = point.runId
  const previous = await getPreviousPoint(point)
  const detailPoint = point.samples
    ? point
    : { ...point, samples: await getPointSamples(point) }
  const detailPrevious =
    previous &&
    (previous.samples
      ? previous
      : { ...previous, samples: await getPointSamples(previous) })
  const run = runById.get(point.runId)
  if (!run) throw new Error("Selected benchmark run is missing")
  getRequiredElement("selected-context").textContent = previous
    ? "Compared with workflow #" +
      previous.runId +
      " from " +
      formatDate(previous.createdAt, true) +
      "."
    : "This is the first comparable run in the chart window."
  const metadataItems = [
    [
      "Workflow",
      '<a href="' +
        escapeHtml(run.runUrl) +
        '">#' +
        escapeHtml(run.runId) +
        "</a>",
    ],
    ["Commit", "<code>" + escapeHtml(run.commitSha.slice(0, 10)) + "</code>"],
    ["Created", escapeHtml(formatDate(run.createdAt, true))],
    ["Runner", escapeHtml(run.runner)],
    ["Dataset", escapeHtml(point.datasetName)],
    [
      "Solver / effort",
      escapeHtml(point.solverName + " · " + point.effortLabel),
    ],
  ]
  runMeta.innerHTML = metadataItems
    .map(
      ([label, value]) =>
        "<div><dt>" +
        label +
        '</dt><dd title="' +
        escapeHtml(String(value).replace(/<[^>]+>/g, "")) +
        '">' +
        value +
        "</dd></div>",
    )
    .join("")
  const detailMetricKeys =
    sampleSelect.value === ""
      ? ["completedRate", "relaxedDrcRate", "p50TimeMs", "p95TimeMs", "avgVia"]
      : ["completedRate", "relaxedDrcRate", "p50TimeMs", "avgVia"]
  getRequiredElement("selected-metrics").innerHTML = detailMetricKeys
    .map((metricKey) => {
      const metric = metricByKey.get(metricKey)
      const delta =
        previous && point[metricKey] !== null && previous[metricKey] !== null
          ? point[metricKey] - previous[metricKey]
          : null
      const label =
        sampleSelect.value !== "" && metricKey === "p50TimeMs"
          ? "Elapsed time"
          : metric.label + (metric.group === "Vias" ? " vias" : "")
      return (
        '<div class="selected-metric"><span>' +
        escapeHtml(label) +
        "</span><strong>" +
        escapeHtml(formatMetricValue(metric, point[metricKey])) +
        '</strong><small class="delta ' +
        getDeltaTone(metric, delta) +
        '">' +
        escapeHtml(formatMetricDelta(metric, delta)) +
        "</small></div>"
      )
    })
    .join("")
  renderSamples(detailPoint, detailPrevious)
}

async function renderRecentRuns() {
  const points = (await getScopedSeriesPoints()).slice(-15).reverse()
  const rows = points.map(
    (point) =>
      '<tr tabindex="0" data-run-id="' +
      escapeHtml(point.runId) +
      '" aria-selected="' +
      String(point.runId === dashboardState.selectedRunId) +
      '"><td>' +
      escapeHtml(formatDate(point.createdAt, true)) +
      "</td><td>" +
      escapeHtml(
        formatMetricValue(
          metricByKey.get("completedRate"),
          point.completedRate,
        ),
      ) +
      "</td><td>" +
      escapeHtml(
        formatMetricValue(
          metricByKey.get("relaxedDrcRate"),
          point.relaxedDrcRate,
        ),
      ) +
      "</td><td>" +
      escapeHtml(
        formatMetricValue(metricByKey.get("p50TimeMs"), point.p50TimeMs),
      ) +
      "</td><td>" +
      escapeHtml(
        formatMetricValue(metricByKey.get("p95TimeMs"), point.p95TimeMs),
      ) +
      "</td><td>" +
      escapeHtml(formatMetricValue(metricByKey.get("avgVia"), point.avgVia)) +
      '</td><td><a href="' +
      escapeHtml(point.runUrl) +
      '">#' +
      escapeHtml(point.runId) +
      "</a></td></tr>",
  )
  recentRunsTable.innerHTML =
    "<caption>Recent runs for the selected dataset, solver, effort, and sample scope</caption>" +
    "<thead><tr><th>Date</th><th>Completion (%)</th><th>DRC (%)</th><th>P50 solve time</th>" +
    "<th>P95 solve time</th><th>Average vias</th><th>Workflow</th></tr></thead><tbody>" +
    rows.join("") +
    "</tbody>"
  recentRunsTable.querySelectorAll("[data-run-id]").forEach((row) => {
    const chooseRow = () => {
      const point = points.find((item) => item.runId === row.dataset.runId)
      if (point) runDashboardTask(selectPoint(point))
    }
    row.addEventListener("click", (event) => {
      if (!event.target.closest("a")) chooseRow()
    })
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        chooseRow()
      }
    })
  })
}

function updateHash() {
  const parameters = new URLSearchParams()
  parameters.set("dataset", datasetSelect.value)
  parameters.set("solver", solverSelect.value)
  parameters.set("effort", effortSelect.value)
  if (sampleSelect.value) parameters.set("sample", sampleSelect.value)
  parameters.set("range", rangeSelect.value)
  parameters.set("metric", dashboardState.metricKey)
  if (dashboardState.selectedRunId)
    parameters.set("run", dashboardState.selectedRunId)
  history.replaceState(null, "", "#" + parameters.toString())
}

async function renderDashboard(resetSelection) {
  const points = await getVisiblePoints()
  if (
    resetSelection ||
    !points.some((point) => point.runId === dashboardState.selectedRunId)
  ) {
    dashboardState.selectedRunId = points[points.length - 1]?.runId ?? null
  }
  renderMetricToolbar()
  await renderHealth()
  await renderChart()
  await renderRunDetails()
  await renderRecentRuns()
  updateHash()
}

async function selectPoint(point) {
  dashboardState.selectedRunId = point.runId
  await renderChart()
  await renderRunDetails()
  await renderRecentRuns()
  updateHash()
}

async function rebuildSampleOptions(preferredValue) {
  const latestPoint = getBaseSeriesPoints().at(-1)
  const samples = latestPoint ? await getPointSamples(latestPoint) : []
  const sampleNumbers = [
    ...new Set(samples.map((sample) => sample.sampleNumber)),
  ].sort((left, right) => left - right)
  const values = ["", ...sampleNumbers.map(String)]
  setSelectOptions(sampleSelect, values, preferredValue, (value) =>
    value === "" ? "All samples" : "Sample " + value,
  )
}

async function rebuildSeriesControls(
  preferredSolver,
  preferredEffort,
  preferredSample,
) {
  const solvers = uniqueSorted(
    dashboardData.points
      .filter((point) => point.datasetName === datasetSelect.value)
      .map((point) => point.solverName),
  )
  setSelectOptions(solverSelect, solvers, preferredSolver)
  const efforts = uniqueSorted(
    dashboardData.points
      .filter(
        (point) =>
          point.datasetName === datasetSelect.value &&
          point.solverName === solverSelect.value,
      )
      .map((point) => point.effortLabel),
  )
  setSelectOptions(effortSelect, efforts, preferredEffort)
  await rebuildSampleOptions(preferredSample)
}

async function initializeControls() {
  const latestPoint = dashboardData.points[dashboardData.points.length - 1]
  const datasets = uniqueSorted(
    dashboardData.points.map((point) => point.datasetName),
  )
  const preferredDataset =
    initialHash.get("dataset") ?? latestPoint?.datasetName ?? null
  setSelectOptions(datasetSelect, datasets, preferredDataset)
  await rebuildSeriesControls(
    initialHash.get("solver") ?? latestPoint?.solverName ?? null,
    initialHash.get("effort") ?? latestPoint?.effortLabel ?? null,
    initialHash.get("sample") ?? "",
  )
  if (["20", "50", "100"].includes(initialHash.get("range"))) {
    rangeSelect.value = initialHash.get("range")
  }
}

async function copyText(text, button, successLabel) {
  let copied = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      copied = true
    }
  } catch (_error) {
    copied = false
  }
  if (!copied) {
    const textarea = document.createElement("textarea")
    textarea.value = text
    document.body.append(textarea)
    textarea.select()
    document.execCommand("copy")
    textarea.remove()
  }
  const originalLabel = button.textContent
  button.textContent = successLabel
  setTimeout(() => {
    button.textContent = originalLabel
  }, 1400)
}

async function getSelectedExportData() {
  const point = await getSelectedPoint()
  if (!point) throw new Error("There is no selected benchmark run to export")
  const previous = await getPreviousPoint(point)
  return {
    point: point.samples
      ? point
      : { ...point, samples: await getPointSamples(point) },
    previous:
      previous &&
      (previous.samples
        ? previous
        : { ...previous, samples: await getPointSamples(previous) }),
    run: runById.get(point.runId),
  }
}

function downloadBlob(fileName, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function quoteCsv(value) {
  const hasValue = value !== null && value !== undefined
  const text = hasValue ? String(value) : ""
  const escapedText = text.replace(/"/g, '""')
  const quotedText = '"' + escapedText + '"'
  return quotedText
}

async function buildSelectedSummary() {
  const { point, previous, run } = await getSelectedExportData()
  const lines = [
    "### Autorouter benchmark " + point.datasetName + " · " + point.solverName,
    "- Run: [" +
      run.runId +
      "](" +
      run.runUrl +
      ") at " +
      formatDate(run.createdAt, true),
    "- Commit: " + run.commitSha,
  ]
  for (const metricKey of [
    "completedRate",
    "relaxedDrcRate",
    "p50TimeMs",
    "p95TimeMs",
    "avgVia",
  ]) {
    const metric = metricByKey.get(metricKey)
    const delta =
      previous && point[metricKey] !== null && previous[metricKey] !== null
        ? point[metricKey] - previous[metricKey]
        : null
    lines.push(
      "- " +
        metric.label +
        ": " +
        formatMetricValue(metric, point[metricKey]) +
        " (" +
        formatMetricDelta(metric, delta) +
        " vs previous)",
    )
  }
  return lines.join("\\n")
}

function setupTheme() {
  let storedTheme = null
  try {
    storedTheme = localStorage.getItem("benchmark-dashboard-theme")
  } catch (_error) {
    storedTheme = null
  }
  const theme =
    storedTheme ??
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
  document.documentElement.dataset.theme = theme
}

function reportDashboardError(error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  getRequiredElement("selected-context").textContent =
    "Dashboard error: " + message
}

function runDashboardTask(task) {
  void task.catch(reportDashboardError)
}

datasetSelect.addEventListener("change", () => {
  runDashboardTask(
    (async () => {
      await rebuildSeriesControls(null, null, "")
      await renderDashboard(true)
    })(),
  )
})
solverSelect.addEventListener("change", () => {
  runDashboardTask(
    (async () => {
      await rebuildSeriesControls(solverSelect.value, null, "")
      await renderDashboard(true)
    })(),
  )
})
effortSelect.addEventListener("change", () => {
  runDashboardTask(
    (async () => {
      await rebuildSampleOptions("")
      await renderDashboard(true)
    })(),
  )
})
sampleSelect.addEventListener("change", () =>
  runDashboardTask(renderDashboard(true)),
)
rangeSelect.addEventListener("change", () =>
  runDashboardTask(renderDashboard(true)),
)
getRequiredElement("metric-toolbar").addEventListener("click", (event) => {
  const button = event.target.closest("[data-metric]")
  if (!button) return
  dashboardState.metricKey = button.dataset.metric
  runDashboardTask(renderDashboard(false))
})
sampleStatusSelect.addEventListener("change", () =>
  runDashboardTask(renderRunDetails()),
)
sampleSearchInput.addEventListener("input", () =>
  runDashboardTask(renderRunDetails()),
)
getRequiredElement("theme-toggle").addEventListener("click", () => {
  const nextTheme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark"
  document.documentElement.dataset.theme = nextTheme
  try {
    localStorage.setItem("benchmark-dashboard-theme", nextTheme)
  } catch (_error) {
    // The hosted dashboard can still switch theme when storage is unavailable.
  }
})
getRequiredElement("copy-link").addEventListener("click", (event) =>
  copyText(location.href, event.currentTarget, "Link copied"),
)
getRequiredElement("copy-summary").addEventListener("click", (event) =>
  runDashboardTask(
    buildSelectedSummary().then((summary) =>
      copyText(summary, event.currentTarget, "Summary copied"),
    ),
  ),
)
getRequiredElement("download-json").addEventListener("click", () =>
  runDashboardTask(
    getSelectedExportData().then((data) =>
      downloadBlob(
        "benchmark-" + data.point.runId + ".json",
        JSON.stringify(data, null, 2),
        "application/json",
      ),
    ),
  ),
)
getRequiredElement("download-csv").addEventListener("click", () =>
  runDashboardTask(
    getSelectedExportData().then(({ point, previous }) => {
      const previousByNumber = new Map(
        (previous?.samples ?? []).map((sample) => [
          sample.sampleNumber,
          sample,
        ]),
      )
      const rows = [
        [
          "scenario",
          "sample_number",
          "status",
          "solve_time_ms",
          "previous_solve_time_ms",
          "drc_passed",
          "previous_drc_passed",
          "via_count",
          "previous_via_count",
          "error_phase",
          "error",
        ],
      ]
      for (const sample of point.samples) {
        const previousSample = previousByNumber.get(sample.sampleNumber)
        rows.push([
          sample.scenarioName,
          sample.sampleNumber,
          formatStatus(sample),
          sample.elapsedTimeMs,
          previousSample?.elapsedTimeMs,
          sample.relaxedDrcPassed,
          previousSample?.relaxedDrcPassed,
          sample.viaCount,
          previousSample?.viaCount,
          sample.errorPhaseName,
          sample.error,
        ])
      }
      downloadBlob(
        "benchmark-" + point.runId + ".csv",
        rows.map((row) => row.map(quoteCsv).join(",")).join("\n"),
        "text/csv",
      )
    }),
  ),
)

async function initializeDashboard() {
  const response = await fetch("./data/index.json")
  if (!response.ok)
    throw new Error(
      "Could not load benchmark dashboard index: HTTP " + response.status,
    )
  dashboardData = await response.json()
  if (
    !dashboardData ||
    !Array.isArray(dashboardData.runs) ||
    !Array.isArray(dashboardData.points)
  ) {
    throw new Error("Benchmark dashboard index is invalid")
  }
  for (const run of dashboardData.runs) {
    if (!run || typeof run.runId !== "string" || typeof run.path !== "string") {
      throw new Error("Benchmark dashboard index contains an invalid run")
    }
    runById.set(run.runId, run)
  }
  setupTheme()
  await initializeControls()
  renderHeader()
  await renderDashboard(false)
}

runDashboardTask(initializeDashboard())
