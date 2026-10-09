#!/bin/sh
# Compile the Kotoba application to a restricted-ESM module for the browser.
set -eu
AMU="${AMU:-amu}"
cd "$(dirname "$0")"
"$AMU" compile src/tsudoi.kotoba --target js-browser --output web/gen/tsudoi.mjs
