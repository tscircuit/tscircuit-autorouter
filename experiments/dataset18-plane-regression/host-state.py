import json
import platform
from pathlib import Path
from datetime import datetime, timezone

paths = [
    "/proc/stat", "/proc/loadavg", "/proc/meminfo",
    "/proc/pressure/cpu", "/proc/pressure/memory",
    "/sys/fs/cgroup/cpu.stat", "/sys/fs/cgroup/memory.events",
]
state = {
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "platform": platform.platform(),
    "files": {path: Path(path).read_text() for path in paths if Path(path).is_file()},
}
print(json.dumps(state))
