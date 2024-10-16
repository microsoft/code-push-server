#!/usr/bin/env sh
set -e
echo "code push server start.sh started executing"
echo "APP_DIR: ${APP_DIR}"
echo "ENV: ${ENV}"
echo "VPC_SUFFIX: ${VPC_SUFFIX}"
echo "TEAM_SUFFIX: ${TEAM_SUFFIX}"
echo "SERVICE_NAME: ${SERVICE_NAME}"

cd "${APP_DIR}" || exit
unset `printenv | grep '_SERVICE\\|_PORT' | grep -o -E '^[^=]+'`

CONSUL_ADDR="config-store-${ENV}.d11dev.com"
VAULT_ADDR="http://secret-store-${ENV}.d11dev.com"
export NODE_ENV="docker"

if [[ "$ENV" == "prod" || "$ENV" == "uat" ]]; then
  CONSUL_ADDR="config-store-${ENV}.dream11.com"
  VAULT_ADDR="http://secret-store-${ENV}.dream11.com"
else
  CONSUL_ADDR="config-store-${ENV}.d11dev.com"
  VAULT_ADDR="http://secret-store-${ENV}.d11dev.com"
fi

CONFIG_OPTS="-upcase -sanitize -flatten -consul-addr ${CONSUL_ADDR} -vault-addr ${VAULT_ADDR} -vault-renew-token=false -prefix d11/${NAMESPACE} -secret secrets/data/d11/${NAMESPACE}/${SERVICE_NAME}/${ENV}/default"
echo "NODE_ENV: ${NODE_ENV}"
echo "CONSUL_ADDR: ${CONSUL_ADDR}"
echo "VAULT_ADDR: ${VAULT_ADDR}"
echo "CONFIG_OPTS: ${CONFIG_OPTS}"

echo "code push server is running"

cd ..

if [[ "$DEPLOYMENT_TYPE" == "container" ]]; then
  envconsul ${CONFIG_OPTS} pm2-runtime start "./pm2/pm2-${ENV}.json" -i 1
else
  envconsul ${CONFIG_OPTS} pm2 start "./pm2/pm2-${ENV}.json" -i 1
fi