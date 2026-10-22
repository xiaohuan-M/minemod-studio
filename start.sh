#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<24||(major===24&&minor<5)){console.error("需要 Node.js 24.5+");process.exit(1)}'
exec npm start
