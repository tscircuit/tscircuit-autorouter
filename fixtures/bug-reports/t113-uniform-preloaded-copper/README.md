# T113-S3 uniform distribution onto preloaded copper

This fixture is captured from the real 41-component T113-S3 supervisor routing
phase. It contains the unrouted Circuit JSON, the Pipeline 9 Simple Route JSON,
and the exact input passed to `UniformPortDistributionSolver`.

On the captured input, port point `ce2335_pp0_z3::3` starts at
`x=-2.042498`, but uniform distribution moves it to `x=-1.789999`. That puts
the port point on the bottom-layer copper of `source_trace_27`, whose vertical
segment is centered at `x=-1.810475551613581`.

The files are deterministically gzip-compressed with `mtime=0`.
