#!/usr/bin/env bash
# publish-release.sh — bump Cloudflare Worker secrets after a new IDE release.
#
# Reads a GitHub release, downloads every `Spud-RawApp-<platform>.zip` asset,
# computes SHA256 + SHA1 for each, and pushes them to the Spud Worker together
# with the commit SHA the release was cut from. After this script runs,
# `GET https://updates.spud.dev/api/update/<platform>/stable/<oldCommit>` starts
# returning a 200 JSON body (auto-update kicks in); before this runs, the
# handler safely returns 204 (no update).
#
# Usage:
#   ./scripts/publish-release.sh <tag>                    # e.g. v0.1.1
#   ./scripts/publish-release.sh <tag> --dry-run          # print without setting
#   DRY_RUN=1 ./scripts/publish-release.sh <tag>
#
# Env (optional):
#   GITHUB_REPO        override `spud-dev-ai/spud-ide`
#   GH_TOKEN           GitHub token (recommended: avoids rate limits, required
#                      for private repos). Script also auto-detects `gh auth`.
#   WRANGLER_ENV       wrangler env name (omit for default)
#   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID  use in CI instead of `wrangler login`
#
# Requires: curl, jq, shasum (macOS/Linux), npx (for wrangler).

set -euo pipefail

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "usage: $0 <tag> [--dry-run]" >&2
  exit 2
fi

DRY_RUN="${DRY_RUN:-0}"
if [[ "${2:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

REPO="${GITHUB_REPO:-spud-dev-ai/spud-ide}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/../worker" && pwd)"

# ── Resolve auth ────────────────────────────────────────────────────────────
if [[ -z "${GH_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  GH_TOKEN="$(gh auth token 2>/dev/null || true)"
fi

auth_header=()
if [[ -n "${GH_TOKEN:-}" ]]; then
  auth_header=(-H "Authorization: Bearer $GH_TOKEN")
fi

gh_api() {
  curl -sfL --retry 3 --retry-delay 2 \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${auth_header[@]}" \
    "$@"
}

# ── Resolve release + commit ────────────────────────────────────────────────
echo "▸ Resolving release $REPO@$TAG …"
RELEASE_JSON="$(gh_api "https://api.github.com/repos/$REPO/releases/tags/$TAG")"

# target_commitish may be a branch; re-resolve to the commit SHA that the tag points to.
TAG_REF="$(gh_api "https://api.github.com/repos/$REPO/git/ref/tags/$TAG")"
# Tag could be annotated (points to tag object) or lightweight (points to commit).
TAG_OBJECT_TYPE="$(jq -r '.object.type' <<<"$TAG_REF")"
if [[ "$TAG_OBJECT_TYPE" == "tag" ]]; then
  TAG_OBJECT_SHA="$(jq -r '.object.sha' <<<"$TAG_REF")"
  COMMIT_SHA="$(gh_api "https://api.github.com/repos/$REPO/git/tags/$TAG_OBJECT_SHA" | jq -r '.object.sha')"
else
  COMMIT_SHA="$(jq -r '.object.sha' <<<"$TAG_REF")"
fi

if [[ -z "$COMMIT_SHA" || "$COMMIT_SHA" == "null" ]]; then
  echo "✖ Could not resolve commit SHA for $TAG" >&2
  exit 1
fi

PUBLISHED_AT="$(jq -r '.published_at // .created_at' <<<"$RELEASE_JSON")"
TIMESTAMP="$(python3 -c "import sys, datetime; print(int(datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')).timestamp()))" "$PUBLISHED_AT" 2>/dev/null || date -u -d "$PUBLISHED_AT" +%s 2>/dev/null || echo "$(date -u +%s)")"

echo "  tag:        $TAG"
echo "  commit:     $COMMIT_SHA"
echo "  published:  $PUBLISHED_AT ($TIMESTAMP)"

# ── Download + hash each Spud-RawApp-*.zip ──────────────────────────────────
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

mapfile -t ASSET_ROWS < <(
  jq -r '.assets[] | select(.name | startswith("Spud-RawApp-") and endswith(".zip")) | "\(.name)\t\(.browser_download_url)"' \
    <<<"$RELEASE_JSON"
)

if [[ ${#ASSET_ROWS[@]} -eq 0 ]]; then
  echo "✖ No Spud-RawApp-*.zip assets on release $TAG." >&2
  echo "  Upload your signed desktop zips (from spud-builder) to the release first." >&2
  exit 1
fi

# platform key => "sha256\tsha1\turl"
declare -A PLATFORM_INFO=()

for row in "${ASSET_ROWS[@]}"; do
  name="${row%$'\t'*}"
  url="${row#*$'\t'}"
  platform="${name#Spud-RawApp-}"
  platform="${platform%.zip}"

  echo "▸ Hashing $name (platform=$platform)"
  out="$tmpdir/$name"
  curl -sfL --retry 3 --retry-delay 2 "${auth_header[@]}" -o "$out" "$url"

  sha256="$(shasum -a 256 "$out" | awk '{print $1}')"
  sha1="$(shasum -a 1   "$out" | awk '{print $1}')"
  echo "    sha256=$sha256"
  echo "    sha1=  $sha1"

  PLATFORM_INFO["$platform"]="${sha256}"$'\t'"${sha1}"$'\t'"${url}"
done

# ── Push to Cloudflare Worker ───────────────────────────────────────────────
put_secret() {
  local name="$1"
  local value="$2"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '  [dry-run] %s = %s\n' "$name" "$value"
    return
  fi
  local args=(wrangler secret put "$name")
  if [[ -n "${WRANGLER_ENV:-}" ]]; then
    args+=(--env "$WRANGLER_ENV")
  fi
  (
    cd "$WORKER_DIR"
    printf '%s' "$value" | npx --yes "${args[@]}"
  )
}

echo "▸ Updating Worker secrets (dry-run=$DRY_RUN)"
put_secret SPUD_LATEST_COMMIT     "$COMMIT_SHA"
put_secret SPUD_RELEASE_TAG       "$TAG"
put_secret SPUD_UPDATE_TIMESTAMP  "$TIMESTAMP"

# Also set the "global" SHAs to the first platform we saw (back-compat: older
# Worker builds only check these). Per-platform overrides below win at request
# time for current builds.
first_platform=""
for platform in "${!PLATFORM_INFO[@]}"; do
  first_platform="$platform"
  break
done

IFS=$'\t' read -r first_sha256 first_sha1 _first_url <<<"${PLATFORM_INFO[$first_platform]}"
put_secret SPUD_UPDATE_SHA256 "$first_sha256"
put_secret SPUD_UPDATE_SHA1   "$first_sha1"

for platform in "${!PLATFORM_INFO[@]}"; do
  IFS=$'\t' read -r sha256 sha1 url <<<"${PLATFORM_INFO[$platform]}"
  key="${platform//-/_}"
  key="${key^^}"
  put_secret "SPUD_UPDATE_SHA256_${key}" "$sha256"
  put_secret "SPUD_UPDATE_SHA1_${key}"   "$sha1"
  put_secret "SPUD_UPDATE_ZIP_URL_${key}" "$url"
done

echo
echo "✔ Done. Smoke test:"
echo "  curl -i https://updates.spud.dev/api/health"
for platform in "${!PLATFORM_INFO[@]}"; do
  echo "  curl -i https://updates.spud.dev/api/update/$platform/stable/oldcommit"
done
