export type StorageConfig =
  | {
      type: "aws";
      bucketName: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    }
  | {
      type: "azure";
      account: string;
      accessKey: string;
    };

export type CacheConfig =
  | {
      type: "elasticache";
      host: string;
      port: string;
      password?: string;
      cluster?: boolean;
    }
  | {
      type: "redis";
      host: string;
      port: string;
      password?: string;
      cluster?: boolean;
    };

export interface CodePushConfig {
  storage: StorageConfig;
  cache: CacheConfig;
}

export function defineConfig(config: CodePushConfig): CodePushConfig {
  return config;
} 