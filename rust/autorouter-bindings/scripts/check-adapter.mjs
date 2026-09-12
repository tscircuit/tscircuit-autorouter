import { fileURLToPath } from "node:url"
import ts from "typescript"

const directory = fileURLToPath(new URL("../", import.meta.url))
const configFile = ts.readConfigFile(`${directory}tsconfig.json`, ts.sys.readFile)
const config = ts.parseJsonConfigFileContent(configFile.config ?? {}, ts.sys, directory)
const program = ts.createProgram(config.fileNames, { ...config.options, skipLibCheck: false })
const diagnostics = [
  ...(configFile.error ? [configFile.error] : []),
  ...config.errors,
  ...program.getOptionsDiagnostics(),
  ...program.getGlobalDiagnostics(),
]

// Generated declarations refer to root solver types. Check adapter sources with
// its stricter flags; the root project checks its sources with its own flags.
for (const path of [...config.fileNames, `${directory}pkg/autorouter_bindings.d.ts`]) {
  const source = program.getSourceFile(path)
  if (!source) throw new Error(`Missing adapter source ${path}`)
  diagnostics.push(...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source))
}
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => directory,
    getNewLine: () => "\n",
  }))
  process.exitCode = 1
}
