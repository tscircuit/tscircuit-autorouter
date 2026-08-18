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
    isLongBenchmark && !parsedArgs.includes("--concurrency")
      ? ["--concurrency", "8"]
      : []
  let datasetName = "dataset01"
  let profileSolvers = false
  let sameMachineCompare = false

  for (let index = 0; index < parsedArgs.length; index += 1) {
    const arg = parsedArgs[index]
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

  return {
    kind: isBenchmarkAll
      ? "benchmark-all"
      : isLongBenchmark
        ? "benchmark-long"
        : "benchmark",
    benchmarkArgs,
    datasetName,
    profileSolvers,
    sameMachineCompare,
  }
}
