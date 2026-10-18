/** @param {string[]} args @returns {boolean} */
const usesNetworkedPipeline9 = (args) => {
  return args.some((arg, index) => {
    if (arg === "--pipeline") {
      return args[index + 1]?.toLowerCase() === "9net"
    }
    return arg === "AutoroutingPipelineSolver9_Networked"
  })
}

const splitShellArgs = (input) => {
  const args = []
  let current = ""
  let quote = null
  let escaping = false
  let tokenStarted = false

  const pushCurrent = () => {
    if (!tokenStarted) return
    args.push(current)
    current = ""
    tokenStarted = false
  }

  for (const char of input) {
    if (escaping) {
      if (quote === '"' && char === "\n") {
        escaping = false
        continue
      }
      if (quote === '"' && !['"', "\\", "$", "`"].includes(char)) {
        current += "\\"
      }
      current += char
      tokenStarted = true
      escaping = false
      continue
    }

    if (quote === "'") {
      if (char === "'") {
        quote = null
      } else {
        current += char
      }
      tokenStarted = true
      continue
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null
      } else if (char === "\\") {
        escaping = true
      } else {
        current += char
      }
      tokenStarted = true
      continue
    }

    if (/\s/.test(char)) {
      pushCurrent()
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      tokenStarted = true
      continue
    }

    if (char === "\\") {
      escaping = true
      tokenStarted = true
      continue
    }

    current += char
    tokenStarted = true
  }

  if (escaping) current += "\\"
  if (quote !== null)
    throw new Error("Unterminated quote in /benchmark command")
  pushCurrent()
  return args
}

export const parsePrBenchmarkCommand = (body) => {
  const command = body.trim()
  const isProfile = /^\/profile(?:\s|$)/.test(command)
  if (isProfile) {
    const parsedArgs = splitShellArgs(command.slice("/profile".length).trim())
    if (usesNetworkedPipeline9(parsedArgs)) {
      throw new Error("Pipeline 9net is only supported by /benchmark")
    }
    if (parsedArgs.includes("--threads")) {
      throw new Error("--threads is only supported by /benchmark")
    }
    let datasetName = "dataset01"

    for (let index = 0; index < parsedArgs.length; index += 1) {
      if (parsedArgs[index] === "--dataset" && parsedArgs[index + 1]) {
        datasetName = parsedArgs[index + 1]
      }
    }

    return {
      kind: "profile",
      benchmarkArgs: parsedArgs,
      datasetName,
      profileSolvers: true,
      sameMachineCompare: true,
    }
  }

  if (/^\/benchmark-effort(?:\s|$)/.test(command)) {
    const args = splitShellArgs(
      command.slice("/benchmark-effort".length).trim(),
    )
    if (args.length !== 0) {
      throw new Error(
        "/benchmark-effort takes no arguments; it compares 1x, 1.5x, and 2x on dataset18",
      )
    }
    return {
      kind: "benchmark-effort",
      benchmarkArgs: [],
      datasetName: "srj18",
      profileSolvers: false,
      sameMachineCompare: false,
    }
  }

  const isBenchmarkAll = /^\/benchmark-all(?:\s|$)/.test(command)
  const isLongBenchmark = /^\/benchmark-long(?:\s|$)/.test(command)
  const isBenchmark = /^\/benchmark(?:\s|$)/.test(command)
  if (!isBenchmarkAll && !isLongBenchmark && !isBenchmark) {
    throw new Error(
      "Expected /profile [args...], /benchmark [args...], /benchmark-long [args...], or /benchmark-all",
    )
  }

  const commandPrefix = isBenchmarkAll
    ? "/benchmark-all"
    : isLongBenchmark
      ? "/benchmark-long"
      : "/benchmark"
  const parsedArgs = splitShellArgs(command.slice(commandPrefix.length).trim())
  const benchmarkArgs =
    isLongBenchmark &&
    !usesNetworkedPipeline9(parsedArgs) &&
    !parsedArgs.includes("--concurrency")
      ? ["--concurrency", "8"]
      : []
  const isNetworkedPipeline9 = usesNetworkedPipeline9(parsedArgs)
  let datasetName = isNetworkedPipeline9 ? "srj18" : "dataset01"
  let profileSolvers = false
  let sameMachineCompare = false

  for (let index = 0; index < parsedArgs.length; index += 1) {
    const arg = parsedArgs[index]
    if (arg === "--threads") {
      const threads = Number(parsedArgs[index + 1])
      if (!Number.isSafeInteger(threads) || threads < 1) {
        throw new Error("--threads must be a positive integer")
      }
      if (threads > 1 && isNetworkedPipeline9) {
        throw new Error("--threads > 1 requires local Pipeline9")
      }
    }
    if (arg === "--same-machine") {
      sameMachineCompare = true
      continue
    }
    if (arg === "--profile-solvers" || arg === "--show-profile-solvers") {
      profileSolvers = true
      continue
    }
    if (arg === "--dataset") {
      if (isBenchmarkAll) {
        throw new Error(
          "/benchmark-all selects every configured dataset and does not accept --dataset",
        )
      }
      if (parsedArgs[index + 1]) datasetName = parsedArgs[index + 1]
    }
    benchmarkArgs.push(arg)
  }

  if (parsedArgs.includes("--threads") && profileSolvers) {
    throw new Error("--threads cannot be combined with --profile-solvers")
  }
  if (isNetworkedPipeline9 && profileSolvers) {
    throw new Error("Pipeline 9net does not support --profile-solvers")
  }

  return {
    kind: isBenchmarkAll
      ? "benchmark-all"
      : isLongBenchmark
        ? "benchmark-long"
        : "benchmark",
    benchmarkArgs,
    datasetName,
    profileSolvers,
    sameMachineCompare:
      sameMachineCompare || isBenchmark || isNetworkedPipeline9,
  }
}
