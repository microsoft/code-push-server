#!/bin/sh

# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

cd api
npm install # Required because npm ci will install only prod dependencies because of app services environment
npm run clean
npm run build

rm -rf /home/site/wwwroot/*
cp -r /home/site/repository/api/* /home/site/wwwroot/
