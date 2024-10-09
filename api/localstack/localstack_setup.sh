#!/bin/sh

# CONSTANTS

region="ap-south-1"

alias aws="aws --endpoint-url=http://localhost:4566 --region=${region}"

# ****** S3 BUCKET SETUP *******

# juspay tenant
aws s3 mb s3://beta-moving-tech-assets