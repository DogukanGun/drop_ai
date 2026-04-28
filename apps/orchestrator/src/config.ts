export const config = {
  port: Number(process.env.PORT ?? 4001),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://dropai:dropai@localhost:5433/dropai',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6380',
  pluginsDir: process.env.PLUGINS_DIR ?? new URL('../../../plugins', import.meta.url).pathname,
  artifactsDir: process.env.ARTIFACTS_DIR ?? new URL('../../../.artifacts', import.meta.url).pathname,
  /** Base URL for the DropAI remote proxy (Claude/Qwen token-gated endpoint). */
  dropaiProxyUrl: process.env.DROPAI_PROXY_URL ?? '',
  /** Secret used to sign JWTs. Must be set in production. */
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
};
