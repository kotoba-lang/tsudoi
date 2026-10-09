#!/bin/sh
# Archive the current web/ as a CAR on Fil One (Filecoin-backed S3).
# Fil One does not serve IPFS, so this is the durable copy, not the gateway:
# `ipfs dag import <cid>.car` on any node restores the same CID.
# Credentials are read from 1Password; nothing is written to disk but the CAR.
set -eu
cd "$(dirname "$0")/.."
ITEM="${FILONE_OP_ITEM:-op://Private/Fil One S3 API key (tsudoi)}"
CID=$(ipfs add -r -Q --cid-version=1 web)
CAR=$(mktemp -t tsudoi).car
ipfs dag export "$CID" > "$CAR"
AWS_ACCESS_KEY_ID=$(op read "$ITEM/username") \
AWS_SECRET_ACCESS_KEY=$(op read "$ITEM/credential") \
AWS_ENDPOINT_URL=https://us-east-1.s3.filonecontent.com AWS_REGION=us-east-1 \
  aws s3api put-object --bucket "${FILONE_BUCKET:-tsudoi}" --key "car/$CID.car" \
    --body "$CAR" --content-type application/vnd.ipld.car \
    --metadata "root-cid=$CID" --query ETag --output text
echo "archived $CID (md5 $(md5 -q "$CAR" 2>/dev/null || md5sum "$CAR" | cut -d' ' -f1))"
rm -f "$CAR"
