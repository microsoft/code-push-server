#!/usr/bin/env bash
set -e
rsync -av --exclude='target' ./ ./target/code-push-server | grep "total"
cd target/code-push-server

export ENV=stag
echo "ENV: ${ENV}"
export SERVICE_NAME="code-push-server"
export NAMESPACE="master"
export CONFIG_BRANCH="master"
echo "SERVICE_NAME: ${SERVICE_NAME}"
echo "CONSUL_TOKEN: ${CONSUL_TOKEN}"
echo "VAULT_TOKEN: ${VAULT_TOKEN}"
echo "NAMESPACE: ${NAMESPACE}"
echo "CONFIG_BRANCH: ${CONFIG_BRANCH}"

export LD_LIBRARY_PATH=/usr/java/jdk1.8.0_191-amd64/jre/lib/amd64/server/
source ~/.nvm/nvm.sh
echo "nvm version"
nvm --version

nvm use 16.13.2
npm cache clean --force

echo "Installing dependencies"
npm install

echo "Install azurite dependencies"
npm install -g azurite
azurite -s &

echo "Wait for 5 seconds"
sleep 5

npm run build