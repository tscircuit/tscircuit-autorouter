import ts from "typescript"

type SourceEdit = { offset: number; insertion: string }
export type InstrumentedSource = {
  contents: string
  methods: string[]
  constructors: string[]
}

/** Instrument the loaded source, without replacing prototypes or changing files. */
export function instrumentSolverSource(options: {
  source: string
  path: string
  runtimePath: string
}): InstrumentedSource {
  const syntax = ts.createSourceFile(options.path, options.source, ts.ScriptTarget.Latest, true)
  const edits: SourceEdit[] = []
  const methods: string[] = []
  const constructors: string[] = []
  const pending: ts.Node[] = [syntax]
  while (pending.length) {
    const node = pending.pop()!
    ts.forEachChild(node, (child) => { pending.push(child) })
    if (ts.isMethodDeclaration(node) && node.body &&
      ["step", "_step", "solve", "setup", "_setup"].includes(node.name.getText(syntax))) {
      if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) || node.asteriskToken) {
        throw new Error(`Async/generator solver lifecycle cannot use synchronous profiling: ${options.path}`)
      }
      const owner = ts.isClassLike(node.parent) && node.parent.name ? node.parent.name.text : options.path
      const method = node.name.getText(syntax)
      const label = JSON.stringify({ owner: `${options.path}:${owner}`, method })
      edits.push({ offset: node.body.getStart(syntax) + 1, insertion: `\nconst __srj18Span = __srj18Profile.enter(this, ${label}); try {\n` })
      edits.push({ offset: node.body.end - 1, insertion: "\n} finally { __srj18Profile.exit(__srj18Span); }\n" })
      methods.push(`${owner}.${method}`)
    }
    if (ts.isNewExpression(node) && /solver/i.test(node.expression.getText(syntax))) {
      const constructor = node.expression.getText(syntax)
      edits.push({ offset: node.getStart(syntax), insertion: "__srj18Profile.construct(() => (" })
      edits.push({ offset: node.end, insertion: `), ${JSON.stringify(constructor)})` })
      constructors.push(constructor)
    }
  }
  let contents = options.source
  for (const edit of edits.map((edit, index) => ({ ...edit, index })).sort((left, right) => right.offset - left.offset || right.index - left.index)) {
    contents = contents.slice(0, edit.offset) + edit.insertion + contents.slice(edit.offset)
  }
  if (edits.length) {
    contents = `import { solverProfile as __srj18Profile } from ${JSON.stringify(options.runtimePath)};\n${contents}`
  }
  return { contents, methods, constructors }
}
