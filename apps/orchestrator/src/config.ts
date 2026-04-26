export const config = {
  port: Number(process.env.PORT ?? 4001),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://dropai:dropai@localhost:5433/dropai',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6380',
  pluginsDir: process.env.PLUGINS_DIR ?? new URL('../../../plugins', import.meta.url).pathname,
  artifactsDir: process.env.ARTIFACTS_DIR ?? new URL('../../../.artifacts', import.meta.url).pathname,
};
