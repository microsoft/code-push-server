import { defineConfig } from "./config-utils";

export default defineConfig({
  storage:
    process.env.STORAGE_PROVIDER === "aws"
      ? {
          type: "aws",
          bucketName: process.env.S3_BUCKET_NAME!,
          region: process.env.AWS_REGION!,
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        }
      : {
          type: "azure",
          account: process.env.AZURE_STORAGE_ACCOUNT!,
          accessKey: process.env.AZURE_STORAGE_ACCESS_KEY!,
        },
  cache:
    process.env.CACHE_PROVIDER === "aws"
      ? {
          type: "elasticache",
          host: process.env.ELASTICACHE_HOST!,
          port: process.env.ELASTICACHE_PORT!,
          password: process.env.ELASTICACHE_PASSWORD,
          cluster: process.env.ELASTICACHE_CLUSTER === "true",
        }
      : {
          type: "redis",
          host: process.env.REDIS_HOST!,
          port: process.env.REDIS_PORT!,
          password: process.env.REDIS_KEY,
          cluster: process.env.REDIS_CLUSTER_ENABLED === "true",
        },
}); 