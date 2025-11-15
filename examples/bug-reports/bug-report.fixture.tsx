import { FormEvent, useEffect, useMemo, useState } from "react"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"

export default () => {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const initialBugReportId =
    params.get("bug_report_id") ?? params.get("autorouting_bug_report_id")
  const [bugReportId, setBugReportId] = useState<string | null>(
    initialBugReportId,
  )
  const [srj, setSrj] = useState<SimpleRouteJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [manualInput, setManualInput] = useState("")
  const [inputError, setInputError] = useState<string | null>(null)

  const extractBugReportId = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return null

    try {
      const possibleUrl = new URL(trimmed)
      const idFromUrl =
        possibleUrl.searchParams.get("bug_report_id") ??
        possibleUrl.searchParams.get("autorouting_bug_report_id")
      if (idFromUrl) {
        return idFromUrl
      }
    } catch (err) {
      // Ignore URL parsing errors, we'll handle other cases below
    }

    const queryMatch = trimmed.match(
      /(?:bug_report_id|autorouting_bug_report_id)=([\w-]+)/i,
    )
    if (queryMatch) {
      return queryMatch[1]
    }

    if (/^[\w-]{6,}$/.test(trimmed)) {
      return trimmed
    }

    return null
  }

  const handleManualSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const extractedId = extractBugReportId(manualInput)

    if (!extractedId) {
      setInputError("Could not find a bug report ID in the provided input.")
      return
    }

    setInputError(null)
    setManualInput("")
    const url = new URL(window.location.href)
    url.searchParams.set("bug_report_id", extractedId)
    window.history.replaceState(null, "", url.toString())
    setBugReportId(extractedId)
  }

  useEffect(() => {
    if (!bugReportId) return
    setError(null)
    setSrj(null)
    const url =
      "https://api.tscircuit.com/autorouting/bug_reports/get?autorouting_bug_report_id=" +
      bugReportId +
      "&download=true"
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.autorouting_bug_report) {
          setSrj(data.autorouting_bug_report.simple_route_json)
        } else {
          setError("Bug report not found")
        }
      })
      .catch((err) => {
        console.error(err)
        setError("Failed to load bug report")
      })
  }, [bugReportId])

  if (!bugReportId) {
    return (
      <div className="p-4 space-y-4">
        <div>No bug_report_id specified in URL.</div>
        <form onSubmit={handleManualSubmit} className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Enter a bug report URL or ID
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={manualInput}
              onChange={(event) => setManualInput(event.target.value)}
              placeholder="https://...bug_report_id=1234 or 1234"
              className="flex-1 rounded border border-gray-300 px-3 py-2"
            />
            <button
              type="submit"
              className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
            >
              Load bug report
            </button>
          </div>
          {inputError ? (
            <p className="text-sm text-red-500">{inputError}</p>
          ) : null}
        </form>
      </div>
    )
  }
  if (error) {
    return <div className="p-4 text-red-500">{error}</div>
  }
  if (!srj) {
    return <div className="p-4">Loading bug report...</div>
  }
  return <AutoroutingPipelineDebugger srj={srj} />
}
