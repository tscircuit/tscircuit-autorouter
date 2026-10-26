# Explicit initial path-finding effort

Pipeline9 keeps `effort > 1` for cleanup, preserving the initial route. Set
`pathingEffort: 8` explicitly to give its native initial graph search sixteen
million iterations instead of two million. Cleanup effort stays independent.
The outer iteration cap grows to accommodate the requested child budget.

![Solved native zero-DRC control](completed-control.png)

The generated two-pad control solves with identical copper at default, 8 and
100 pathing effort. The focused test also rejects invalid values and verifies
that large child budgets fit within the outer cap. Paired Blacksmith controls
and the full 85-case benchmark must be reported before merge; the small control
demonstrates configuration and unchanged copper, not difficult-board completion.
