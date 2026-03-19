#!/bin/bash
#
# OpenClaw + PowerMem memory plugin installer
# Usage (from GitHub):
#   curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash
# Or from repo root:
#   bash install.sh [ -y ] [ --workdir PATH ]
#
# Env:
#   REPO=owner/repo     - GitHub repo for download (default: ob-labs/memory-powermem)
#   BRANCH=branch       - Branch/tag (default: main)
#   INSTALL_YES=1       - Non-interactive (same as -y)
#   SKIP_OPENCLAW=1     - Skip openclaw presence check
#

set -e

REPO="${REPO:-ob-labs/memory-powermem}"
BRANCH="${BRANCH:-main}"
INSTALL_YES="${INSTALL_YES:-0}"
SKIP_OC="${SKIP_OPENCLAW:-0}"
HOME_DIR="${HOME:-$USERPROFILE}"
OPENCLAW_DIR="${HOME_DIR}/.openclaw"
PLUGIN_DEST="${OPENCLAW_DIR}/extensions/memory-powermem"
SELECTED_MODE="http"
BASE_URL="http://localhost:8000"
API_KEY=""
ENV_FILE=""
PMEM_PATH="pmem"

# Parse args (curl | bash -s -- ...)
_expect_workdir=""
for arg in "$@"; do
  if [[ -n "$_expect_workdir" ]]; then
    if [[ "$arg" == -* ]]; then
      echo "install.sh: Warning: Missing value for --workdir; ignoring." >&2
      _expect_workdir=""
    else
      OPENCLAW_DIR="$arg"
      PLUGIN_DEST="${OPENCLAW_DIR}/extensions/memory-powermem"
      _expect_workdir=""
    fi
    continue
  fi
  [[ "$arg" == "-y" || "$arg" == "--yes" ]] && INSTALL_YES="1"
  [[ "$arg" == "--workdir" ]] && { _expect_workdir="1"; continue; }
  [[ "$arg" == "-h" || "$arg" == "--help" ]] && {
    echo "Usage: curl -fsSL <INSTALL_URL> | bash [-s -- -y --workdir <path>]"
    echo "   or: bash install.sh [-y] [--workdir <path>]"
    echo ""
    echo "Options:"
    echo "  -y, --yes        Non-interactive (defaults: http, baseUrl http://localhost:8000)"
    echo "  --workdir <path> OpenClaw config dir (default: ~/.openclaw)"
    echo "  -h, --help       Show this help"
    echo ""
    echo "Env: REPO, BRANCH, INSTALL_YES, SKIP_OPENCLAW"
    exit 0
  }
done
if [[ -n "$_expect_workdir" ]]; then
  echo "install.sh: ERROR: Option --workdir requires a path." >&2
  exit 1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }
bold()  { echo -e "${BOLD}$1${NC}"; }

# Detect OS
case "$(uname -s)" in
  Linux*)   OS="linux";;
  Darwin*)  OS="macos";;
  CYGWIN*|MINGW*|MSYS*) OS="windows";;
  *)        OS="unknown";;
esac
if [[ "$OS" == "windows" ]]; then
  err "Windows is not supported by this script. Use manual install (see INSTALL.md)."
  exit 1
fi

# Detect if we're running from repo root (have package.json + openclaw.plugin.json)
FROM_REPO=0
if [[ -f "package.json" && -f "openclaw.plugin.json" ]]; then
  FROM_REPO=1
fi

detect_openclaw_instances() {
  local list=()
  for d in "${HOME_DIR}"/.openclaw "${HOME_DIR}"/.openclaw-*; do
    [[ -d "$d" ]] || continue
    [[ "$(basename "$d")" == .openclaw ]] || [[ "$(basename "$d")" == .openclaw-* ]] || continue
    list+=("$d")
  done
  printf '%s\n' "${list[@]}"
}

select_workdir() {
  local instances=()
  mapfile -t instances < <(detect_openclaw_instances) || true
  if [[ ${#instances[@]} -le 1 ]]; then
    return 0
  fi
  if [[ "$INSTALL_YES" != "1" ]]; then
    echo ""
    bold "Found multiple OpenClaw instances:"
    local i=1
    for inst in "${instances[@]}"; do
      echo "  ${i}) ${inst}"
      i=$((i + 1))
    done
    echo ""
    read -r -p "Select instance number [1]: " _choice < /dev/tty || true
    if [[ -n "$_choice" && "$_choice" =~ ^[0-9]+$ ]]; then
      local idx=$((_choice - 1))
      if [[ $idx -ge 0 && $idx -lt ${#instances[@]} ]]; then
        OPENCLAW_DIR="${instances[$idx]}"
        PLUGIN_DEST="${OPENCLAW_DIR}/extensions/memory-powermem"
      fi
    fi
  fi
}

select_mode_and_config() {
  if [[ "$INSTALL_YES" == "1" ]]; then
    SELECTED_MODE="http"
    BASE_URL="http://localhost:8000"
    return 0
  fi
  echo ""
  read -r -p "Backend mode: http or cli [http]: " _mode < /dev/tty || true
  _mode="${_mode:-http}"
  if [[ "$_mode" == "cli" ]]; then
    SELECTED_MODE="cli"
    read -r -p "Path to PowerMem .env (optional): " ENV_FILE < /dev/tty || true
    read -r -p "pmem binary path [pmem]: " _pmem < /dev/tty || true
    PMEM_PATH="${_pmem:-pmem}"
  else
    SELECTED_MODE="http"
    read -r -p "PowerMem server base URL [http://localhost:8000]: " _url < /dev/tty || true
    BASE_URL="${_url:-http://localhost:8000}"
    read -r -p "API Key (optional): " API_KEY < /dev/tty || true
  fi
}

check_openclaw() {
  if [[ "$SKIP_OC" == "1" ]]; then
    info "Skipping OpenClaw check (SKIP_OPENCLAW=1)"
    return 0
  fi
  if command -v openclaw >/dev/null 2>&1; then
    info "OpenClaw detected ✓"
    return 0
  fi
  err "OpenClaw not found. Install it first, then rerun this script."
  echo ""
  echo "  npm install -g openclaw"
  echo "  openclaw --version"
  echo "  openclaw onboard"
  echo ""
  exit 1
}

deploy_from_repo() {
  info "Deploying plugin from current directory..."
  mkdir -p "${PLUGIN_DEST}"
  for f in index.ts config.ts client.ts client-cli.ts openclaw.plugin.json package.json tsconfig.json .gitignore; do
    if [[ -f "$f" ]]; then
      cp "$f" "${PLUGIN_DEST}/"
    fi
  done
  if [[ -f "README.md" ]]; then
    cp README.md "${PLUGIN_DEST}/" || true
  fi
  info "Installing plugin dependencies..."
  (cd "${PLUGIN_DEST}" && npm install --no-audit --no-fund) || {
    err "npm install failed in ${PLUGIN_DEST}"
    exit 1
  }
  info "Plugin deployed: ${PLUGIN_DEST}"
}

deploy_from_github() {
  # REPO defaults to ob-labs/memory-powermem
  [[ -n "$REPO" ]] || REPO="ob-labs/memory-powermem"
  local gh_raw="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
  local files=(
    "index.ts"
    "config.ts"
    "client.ts"
    "client-cli.ts"
    "openclaw.plugin.json"
    "package.json"
    "tsconfig.json"
    ".gitignore"
  )
  mkdir -p "${PLUGIN_DEST}"
  info "Downloading plugin from ${REPO}@${BRANCH}..."
  for f in "${files[@]}"; do
    local url="${gh_raw}/${f}"
    if curl -fsSL --connect-timeout 15 --max-time 60 -o "${PLUGIN_DEST}/${f}" "${url}" 2>/dev/null; then
      echo "  ${f} ✓"
    else
      [[ "$f" == ".gitignore" ]] && echo "node_modules/" > "${PLUGIN_DEST}/${f}" || {
        err "Download failed: ${url}"
        exit 1
      }
    fi
  done
  info "Installing plugin dependencies..."
  (cd "${PLUGIN_DEST}" && npm install --no-audit --no-fund) || {
    err "npm install failed in ${PLUGIN_DEST}"
    exit 1
  }
  info "Plugin deployed: ${PLUGIN_DEST}"
}

configure_openclaw() {
  info "Configuring OpenClaw..."
  local oc_env=()
  if [[ "$OPENCLAW_DIR" != "${HOME_DIR}/.openclaw" ]]; then
    oc_env=(env OPENCLAW_STATE_DIR="$OPENCLAW_DIR")
  fi

  "${oc_env[@]}" openclaw config set plugins.enabled true
  "${oc_env[@]}" openclaw config set plugins.allow '["memory-powermem"]' --json
  "${oc_env[@]}" openclaw config set plugins.slots.memory memory-powermem
  "${oc_env[@]}" openclaw config set plugins.load.paths "[\"${PLUGIN_DEST}\"]" --json

  "${oc_env[@]}" openclaw config set plugins.entries.memory-powermem.config.mode "${SELECTED_MODE}"
  "${oc_env[@]}" openclaw config set plugins.entries.memory-powermem.config.autoCapture true --json
  "${oc_env[@]}" openclaw config set plugins.entries.memory-powermem.config.autoRecall true --json
  "${oc_env[@]}" openclaw config set plugins.entries.memory-powermem.config.inferOnAdd true --json

  if [[ "$SELECTED_MODE" == "http" ]]; then
    "${oc_env[@]}" openclaw config set plugins.entries.memory-powermem.config.baseUrl "${BASE_URL}"
    [[ -n "$API_KEY" ]] && "${oc_env[@]}" openclaw config set plugins.entries.memory-powermem.config.apiKey "${API_KEY}"
  else
    "${oc_env[@]}" openclaw config set plugins.entries.memory-powermem.config.pmemPath "${PMEM_PATH}"
    [[ -n "$ENV_FILE" ]] && "${oc_env[@]}" openclaw config set plugins.entries.memory-powermem.config.envFile "${ENV_FILE}"
  fi

  info "OpenClaw plugin configured ✓"
}

main() {
  echo ""
  bold "OpenClaw + PowerMem memory plugin installer"
  echo ""

  select_workdir
  info "Target: ${OPENCLAW_DIR}"

  select_mode_and_config
  info "Mode: ${SELECTED_MODE}"

  check_openclaw

  if [[ "$FROM_REPO" == "1" ]]; then
    deploy_from_repo
  else
    deploy_from_github
  fi

  configure_openclaw

  echo ""
  bold "════════════════════════════════════════"
  bold "  Installation complete!"
  bold "════════════════════════════════════════"
  echo ""
  info "Next steps:"
  if [[ "$SELECTED_MODE" == "http" ]]; then
    echo "  1. Start PowerMem server (e.g. in a dir with .env): powermem-server --port 8000"
    echo "  2. openclaw gateway"
    echo "  3. openclaw ltm health"
  else
    echo "  1. Ensure pmem is on PATH (and optional .env)"
    echo "  2. openclaw gateway"
    echo "  3. openclaw ltm health"
  fi
  echo ""
}

main "$@"
