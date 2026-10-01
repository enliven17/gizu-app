#!/usr/bin/env bash
set -euo pipefail
# Per disposable fork: 1 GiB virtual memory, 60 CPU seconds, no core dumps.
# App timeout/teardown also bounds wall time to 30 s by default, at most 60 s.
ulimit -v 1048576
ulimit -t 60
ulimit -c 0
export RAYON_NUM_THREADS=1
export TOKIO_WORKER_THREADS=2
anvil_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "${anvil_dir}/anvil" --no-storage-caching "$@"
