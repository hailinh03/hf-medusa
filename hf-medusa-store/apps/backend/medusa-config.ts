import { loadEnv, defineConfig, Modules } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const REDIS_URL = process.env.REDIS_URL

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  modules: [
    // ── Redis-backed infra (SRS §2.1, §9.1: cache TTL, cart.updated events, workflow engine) ──
    // These override built-in in-memory modules, so each needs an explicit `key`
    // pointing at the slot it replaces. Falls back to in-memory when REDIS_URL is unset.
    ...(REDIS_URL
      ? [
          {
            key: Modules.CACHE,
            resolve: '@medusajs/cache-redis',
            options: { redisUrl: REDIS_URL },
          },
          {
            key: Modules.EVENT_BUS,
            resolve: '@medusajs/event-bus-redis',
            options: { redisUrl: REDIS_URL },
          },
          {
            key: Modules.WORKFLOW_ENGINE,
            resolve: '@medusajs/workflow-engine-redis',
            options: { redis: { redisUrl: REDIS_URL } },
          },
        ]
      : []),
    // ── File storage: S3 provider when configured, else Medusa's default local ──
    ...(process.env.S3_BUCKET
      ? [
          {
            resolve: '@medusajs/medusa/file',
            options: {
              providers: [
                {
                  resolve: '@medusajs/file-s3',
                  id: 's3',
                  options: {
                    file_url: process.env.S3_FILE_URL,
                    access_key_id: process.env.S3_ACCESS_KEY_ID,
                    secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
                    region: process.env.S3_REGION,
                    bucket: process.env.S3_BUCKET,
                  },
                },
              ],
            },
          },
        ]
      : []),
    // ── Custom domain modules ──
    {
      resolve: './src/modules/suggestive-selling',
    },
  ],
})
