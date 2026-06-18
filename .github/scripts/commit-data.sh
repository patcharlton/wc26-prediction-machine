#!/usr/bin/env bash
# Conflict-proof commit of the engine's freshly-computed data/ back to main.
#
# Two data-writing jobs (main-update and a live-status session) run in different
# concurrency groups and can push within seconds of each other. A text rebase of
# two divergent full-snapshot JSON files conflicts (and could even yield invalid
# JSON), which is what was failing main-update. Instead we never merge: take the
# latest origin/main and overlay THIS run's data/ as one mutually-consistent
# unit, then push. Last consistent writer wins; a transiently overwritten live
# score is re-applied on the next poll.
set -uo pipefail
MSG="${1:?commit message required}"
cd "$(git rev-parse --show-toplevel)"

git config user.name  "wc26-bot"
git config user.email "actions@github.com"

# Nothing to do?
if git diff --quiet -- data/ && git diff --cached --quiet -- data/; then
  echo "[commit-data] no data changes."; exit 0
fi

# Skip a pure lastRun bookkeeping change (meta.json timestamp only), but keep
# budget-counter (requestsToday) changes so API accounting persists.
changed="$(git status --porcelain -- data/ | awk '{print $2}' | sort -u)"
if [ "$changed" = "data/meta.json" ] && ! git diff -- data/meta.json | grep -q requestsToday; then
  echo "[commit-data] only lastRun bookkeeping changed — skipping."; exit 0
fi

# Snapshot our computed data as a consistent unit, then replay it onto latest.
snap="$(mktemp -d)"
cp -a data/. "$snap"/
cleanup() { rm -rf "$snap"; }
trap cleanup EXIT

for attempt in 1 2 3 4 5; do
  git fetch -q origin main || true
  git reset -q --hard origin/main
  cp -a "$snap"/. data/
  git add data/
  if git diff --cached --quiet; then
    echo "[commit-data] remote already current."; exit 0
  fi
  git commit -q -m "$MSG"
  if git push -q origin HEAD:main; then
    echo "[commit-data] pushed (attempt $attempt)."; exit 0
  fi
  echo "[commit-data] push rejected (attempt $attempt); re-overlaying on latest…"
  sleep $(( attempt * 3 ))
done
echo "[commit-data] FAILED after retries"; exit 1
