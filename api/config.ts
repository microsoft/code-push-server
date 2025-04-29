import { defineConfig, StorageType } from "./config-utils";

// Fix the storage provider selection logic to properly respect STORAGE_PROVIDER
const useAzureStorage = process.env.STORAGE_PROVIDER === "azure" && 
                        process.env.AZURE_STORAGE_ACCOUNT && 
                        process.env.AZURE_STORAGE_ACCESS_KEY;

export default defineConfig({
  storage:
    useAzureStorage
      ? {
          type: StorageType.AZURE,
          account: process.env.AZURE_STORAGE_ACCOUNT!,
          accessKey: process.env.AZURE_STORAGE_ACCESS_KEY!,
        }
      : {
          type: StorageType.AWS,
          bucketName: process.env.S3_BUCKET_NAME!,
          region: process.env.AWS_REGION!,
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
  cache: {
    type: "redis",
    host: process.env.REDIS_HOST!,
    port: process.env.REDIS_PORT!,
  }
}); 