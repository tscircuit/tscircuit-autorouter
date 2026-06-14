# Current Process

## Scope Reduction

To reduce Blacksmith benchmark cost, SRJ18 is filtered to only samples where
`ComponentDetectionSolver` detects at least one `bga` component.

## BGA Samples In SRJ18

- `2` (`sample002`)
- `6` (`sample006`)
- `7` (`sample007`)
- `8` (`sample008`)
- `9` (`sample009`)
- `10` (`sample010`)
- `13` (`sample013`)
- `14` (`sample014`)

## Active Benchmark Command

```sh
./benchmark.sh --pipeline 7 --dataset 18 --sample-numbers 2,6,7,8,9,10,13,14 --sample-timeout 600s
```

## Why

- The current regression focus is BGA component topology generation.
- Non-BGA SRJ18 samples add benchmark cost without helping isolate this bug.
- `600s` timeout is required to distinguish logic failures from premature
  timeout noise on long-running cases.
