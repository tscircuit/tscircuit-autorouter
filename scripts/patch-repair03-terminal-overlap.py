from pathlib import Path
path = Path('node_modules/high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers.ts')
source = path.read_text()
start = source.index('export const applyTerminalViaRelocationForError = (')
old = '  if (getDrcErrorType(error) !== "pcb_pad_trace_clearance_error") return false'
index = source.index(old, start)
new = '''  const errorType = getDrcErrorType(error)
  if (errorType !== "pcb_pad_trace_clearance_error" && errorType !== "pcb_trace_error") return false'''
path.write_text(source[:index] + new + source[index + len(old):])
