#!/bin/sh
# Pin the current web/ on Filecoin through Filecoin Onchain Cloud
# (filecoin-pin). The provider announces the CID to IPNI and serves it as a
# trustless IPFS gateway, so the site stays retrievable by CID without any
# machine of ours being online.
#
# Needs a one-time `filecoin-pin login` (session key approved in the
# Filecoin Pay console), the Warm Storage service approved there, and a
# USDFC deposit. `--dry-run` first shows the cost.
set -eu
cd "$(dirname "$0")/.."
FP="${FILECOIN_PIN:-filecoin-pin}"
CID=$(ipfs add -r -Q --cid-version=1 web)
CAR=$(mktemp -t tsudoi).car
ipfs dag export "$CID" > "$CAR"
"$FP" import "$CAR" --copies "${COPIES:-1}" --metadata app=tsudoi "$@"
rm -f "$CAR"
