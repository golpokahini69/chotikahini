#!/usr/bin/env bash
# ============================================================================
# Pre-flight disk-space guard.
#
# WHY THIS EXISTS:
#   When the disk fills up mid-build, webpack's chunk emit fails partway. The
#   result is a HALF-WRITTEN `.next/server/vendor-chunks/` directory: the
#   compiled route still references all six chunks, but only a couple of them
#   made it to disk. The dev server then serves HTTP 500 with
#
#     Cannot find module './vendor-chunks/@supabase.js'
#
#   or
#
#     TypeError: __webpack_modules__[moduleId] is not a function
#
#   Neither error mentions disk space, and both look exactly like a bug in the
#   route that happened to compile second. The real cause is ENOSPC.
#
#   The failure is also non-deterministic: a route that returns 200 can start
#   returning 500 with no code change at all, which makes it very easy to
#   waste hours chasing a phantom source bug.
#
# WHAT IT DOES:
#   Checks free space on the volume holding the repo and fails loudly if it is
#   below the threshold. A full `next build` of this app needs roughly 2 GiB
#   of scratch space (`.next/cache/webpack` alone grows past 280 MB).
#
# WHERE IT RUNS:
#   Only on a developer machine. On Vercel (and any other CI) the container
#   filesystem is ephemeral and its free space is not ours to reason about, so
#   the guard skips itself entirely — otherwise it would fail the deploy for
#   a condition that does not apply there.
#
# USAGE:
#   bash scripts/check-disk-space.sh          # check, warn + exit 1 if low
#   bash scripts/check-disk-space.sh --quiet  # only print when it fails
# ============================================================================

set -uo pipefail

# Skip on Vercel and other CI: the ENOSPC failure this guards against is a
# local-machine problem (a half-written build directory), and CI containers
# do not guarantee the free space this threshold demands.
if [ -n "${VERCEL:-}" ] || [ -n "${CI:-}" ]; then
  exit 0
fi

# Minimum free space we want on the volume before running a build.
# The build's own scratch usage peaks around 1.5-2 GiB, so anything below
# this means the build is likely to fail with ENOSPC partway through.
MIN_FREE_GB="${MIN_FREE_GB:-4}"

QUIET=0
if [ "${1:-}" = "--quiet" ]; then
  QUIET=1
fi

# Resolve the volume that actually holds the repo. `df -h .` reports the
# volume for the current directory, which is what matters — on macOS the
# system volume and the data volume are separate mounts.
DF_OUT="$(df -k . 2>/dev/null | awk 'NR==2 {print $4}')"

if [ -z "$DF_OUT" ]; then
  echo "✗ could not determine free disk space for $(pwd)" >&2
  exit 1
fi

# df reports 1K blocks; convert to GiB.
FREE_GB="$(awk -v kb="$DF_OUT" 'BEGIN { printf "%.1f", kb / 1024 / 1024 }')"

# Compare as integers of tenths to avoid float comparison issues.
FREE_TENTHS="$(awk -v kb="$DF_OUT" 'BEGIN { printf "%d", kb * 10 / 1024 / 1024 }')"
MIN_TENTHS="$(awk -v g="$MIN_FREE_GB" 'BEGIN { printf "%d", g * 10 }')"

if [ "$FREE_TENTHS" -lt "$MIN_TENTHS" ]; then
  cat >&2 <<EOF

✗ NOT ENOUGH DISK SPACE TO BUILD SAFELY

  Free:  ${FREE_GB} GiB
  Need:  ${MIN_FREE_GB} GiB

  A build that runs out of disk space does NOT fail with a clear "disk full"
  error. It fails with a half-written .next directory, which surfaces as
  bogus route errors like:

    Error: Cannot find module './vendor-chunks/@supabase.js'
    TypeError: __webpack_modules__[moduleId] is not a function

  Those look like source bugs but are pure ENOSPC. Free some space and retry:

    rm -rf .next                    # ~300 MB of build cache
    rm -rf ~/Library/Caches/ms-playwright
    rm -rf ~/Library/Caches/Google

EOF
  exit 1
fi

if [ "$QUIET" -eq 0 ]; then
  echo "✓ disk space OK — ${FREE_GB} GiB free (need ${MIN_FREE_GB} GiB)"
fi

exit 0
