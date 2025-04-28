import { defineConfig, StorageType } from "./config-utils";

console.log("=== Loading Config ===");
console.log("STORAGE_PROVIDER:", process.env.STORAGE_PROVIDER);
console.log("AWS Keys Present:", !!process.env.AWS_ACCESS_KEY_ID, !!process.env.AWS_SECRET_ACCESS_KEY);
console.log("Azure Keys Present:", !!process.env.AZURE_STORAGE_ACCOUNT, !!process.env.AZURE_STORAGE_ACCESS_KEY);
console.log("S3 Bucket:", process.env.S3_BUCKET_NAME);
console.log("S3 Endpoint:", process.env.S3_ENDPOINT);
console.log("Azure Storage Account:", process.env.AZURE_STORAGE_ACCOUNT);
console.log("Redis Host:", process.env.REDIS_HOST);
console.log("Redis Port:", process.env.REDIS_PORT);

// Fix the storage provider selection logic to properly respect STORAGE_PROVIDER
const useAzureStorage = process.env.STORAGE_PROVIDER === "azure" && 
                        process.env.AZURE_STORAGE_ACCOUNT && 
                        process.env.AZURE_STORAGE_ACCESS_KEY;

console.log("✅ SELECTED STORAGE PROVIDER:", useAzureStorage ? "Azure Storage" : "AWS S3");

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