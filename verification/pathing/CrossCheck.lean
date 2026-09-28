import PathingContract

open PathingContract

/-- JSONL fixture oracle; use `lake env lean --run` after `lake build`. -/
def rootJson (root : Option Nat) : String :=
  match root with
  | none => "null"
  | some n => toString n

def main : IO Unit := do
  for current in [none, some 0, some 1] do
    for assigned in [none, some 0, some 1] do
      let allowed := validatedReuse current assigned
      IO.println ("{\"kind\":\"reuse\",\"current\":" ++ rootJson current ++
        ",\"assigned\":" ++ rootJson assigned ++ ",\"allowed\":" ++
        toString allowed ++ "}")
  for length in [1, 2, 3, 4, 5, 6] do
    let ports := List.range length
    let injected := Extended.start :: ports.map Extended.original ++ [Extended.finish]
    let projected := injected.filterMap originalPort
    let jsonPorts := String.intercalate "," (projected.map toString)
    IO.println ("{\"kind\":\"chain\",\"length\":" ++ toString length ++
      ",\"injectedLength\":" ++ toString injected.length ++
      ",\"projectedPorts\":[" ++ jsonPorts ++ "]}")
