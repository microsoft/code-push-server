export enum StorageType {
  AWS = "aws",
  AZURE = "azure"
}

export type StorageConfig =
  | {
      type: StorageType.AWS;
      bucketName?: string;
      region?: string;
      accessKeyId: string;
      secretAccessKey: string;
    }
  | {
      type: StorageType.AZURE;
      account: string;
      accessKey: string;
    };

export type CacheConfig = {
  type: "redis";
  host: string;
  port: string;
};

export interface CodePushConfig {
  storage: StorageConfig;
  cache: CacheConfig;
}

export function defineConfig(config: CodePushConfig): CodePushConfig {
  return config;
} 