"""Observed affinity plus a numeric cgroup quota bound sample concurrency."""


def get_cpu_capacity(allowed_cpus, cpu_max):
    if not allowed_cpus or len(set(allowed_cpus)) != len(allowed_cpus) or any(not isinstance(cpu, int) or cpu < 0 for cpu in allowed_cpus):
        raise ValueError("CPU affinity must contain distinct nonnegative IDs")
    quota_cores = None
    observation = "unavailable" if cpu_max is None else "unlimited"
    effective = len(allowed_cpus)
    if cpu_max is not None:
        fields = cpu_max.split()
        if len(fields) != 2 or not fields[1].isdigit() or int(fields[1]) <= 0:
            raise ValueError("Invalid observed cpu.max period")
        if fields[0] != "max":
            if not fields[0].isdigit() or int(fields[0]) <= 0:
                raise ValueError("Invalid observed cpu.max quota")
            quota, period = int(fields[0]), int(fields[1])
            quota_cores = quota / period
            effective = min(effective, quota // period)
            observation = "numeric"
    return {
        "allowedCpuCount": len(allowed_cpus),
        "quotaCores": quota_cores,
        "effectiveCpuCount": effective,
        "quotaObservation": observation,
    }


def validate_cpu_request(concurrency, capacity):
    if not isinstance(concurrency, int) or concurrency < 1:
        raise ValueError("Sample concurrency must be a positive integer")
    effective = capacity["effectiveCpuCount"]
    if concurrency > effective:
        raise ValueError(f"Requested {concurrency} sample lanes exceeds observed CPU capacity {effective}; affinity={capacity['allowedCpuCount']}, quota={capacity['quotaCores']}")
    return concurrency
