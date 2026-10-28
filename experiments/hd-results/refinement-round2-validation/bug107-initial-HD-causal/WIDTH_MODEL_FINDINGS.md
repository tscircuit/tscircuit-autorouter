# Bug107 physical-width model check

The captured HD constructor requests **0.095 mm**, and none of the 44,791 effective point widths falls below that request. Its 6,726 routes use widths 0.095 mm (6,281 routes), 0.1 mm (440), or 0.15 mm (5). The generic A03 under-width defect for a requested 0.15/0.2 mm is not observed for this case’s actual request.

All 6,726 initial route names resolve through the production width resolver to larger per-connection nominal widths. At joint output, 469 of 763 routes contain copper wider than that connection’s initial-HD maximum. This confirms the existing staged width-model difference; it does not establish that the experimental change caused the final regression.

Of the 92 captured final errors, 24 involve a participant route that contains wider copper somewhere. That association does not locate the offending segment. A stronger closed-form check reproduces **all 63 actual via–trace minimum clearances within 1e-8 mm** using the captured final geometry and installed checker’s segment-width semantics. Only **1 of 63 pairs** becomes clear when every segment of that trace is narrowed to its connection’s initial-HD maximum while keeping all centerlines and vias fixed. The other **62 pairs still fail**. Of the closest offending segments, 60 are already at or below the initial maximum width.

The 10 via–via drill errors are independent of trace width. Width is therefore supported as a local contributor to one measured final via–trace pair, not as an explanation of all 92 errors or the old-versus-new board outcome. No routing or DRC was rerun, and no source changed.

Identity uses the exact production nominal-width resolver, exact route-index/trace-ID helpers, and actual converted Circuit JSON via identities. The early HD and final captures use the same source and fixture and have byte-identical point-pair connections; their full earlier geometry was not jointly captured, so a complete earlier-geometry identity claim is not made.

See `WIDTH_MODEL_AUDIT.json` for compact counts and the single pair proof. The deterministic gzip detail archive retains all 63 measurements, all 763 joint-width rows, and all error participant identities.
