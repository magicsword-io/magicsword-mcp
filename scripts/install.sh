#!/usr/bin/env sh
# MagicSword MCP installer (Linux + macOS).
# Usage:
#   curl -fsSL https://www.magicsword.io/install.sh | sh
#   curl -fsSL https://www.magicsword.io/install.sh | sh -s -- --version 0.1.0
#
# Requires: node >= 22 and npm. If you don't have node, install it first
# (https://nodejs.org), then install this package with npm.

set -eu

VERSION="latest"
PACKAGE="@magicsword-io/magicsword-mcp"

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  printf 'Error: node is required (>= 22). Install from https://nodejs.org and retry.\n' >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  printf 'Error: npm is required. Install Node 22+ (which bundles npm) and retry.\n' >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  printf 'Error: node 22+ is required (found %s).\n' "$(node --version)" >&2
  exit 1
fi

printf 'Installing %s@%s globally via npm...\n' "$PACKAGE" "$VERSION"
npm install -g "${PACKAGE}@${VERSION}"

printf '\nInstalled. Next steps:\n'
printf '  1) magicsword-mcp configure   # write ~/.magicsword/mcp.json\n'
printf '  2) Paste the printed snippet into your Claude Desktop config\n'
printf '  3) Restart Claude Desktop\n'
