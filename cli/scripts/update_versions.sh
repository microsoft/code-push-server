#!/bin/bash
set -e

VERSION=$(date +"%Y.%-m.%-d%H%M")

if [ "$BRANCH_NAME" != "main" ]; then
  VERSION="${VERSION}-alpha.${GITHUB_SHA:0:7}"
fi

echo "Updating versions to $VERSION for $BRANCH_NAME"

yarn spaces -p exec -- bash -c '
  jq ".version=\"'"$VERSION"'\"" package.json > package.json.tmp && mv package.json.tmp package.json
'

yarn spaces -p exec -- bash -c '
  jq "if has(\"dependencies\") then .dependencies |= with_entries(select(.key | startswith(\"@angel-studios/\")).value=\"'"$VERSION"'\") else . end" package.json > package.json.tmp && mv package.json.tmp package.json
'