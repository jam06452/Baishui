import { logger } from "./lib/logger.js";
import { initRuntime } from "./lib/runtime.js";
import { runProxy } from "./roles/proxy.js";

async function main() {
  const rt = await initRuntime({
    migrate: true,
    bootstrap: process.env.ROLE === "proxy" || process.env.ROLE === "all",
  });

  // ponytail: worker role killed — rollup wrote to a table nobody reads,
  // pg-boss queue had no registered jobs. Re-add a worker when there's an
  // actual background job (model sync cron, quota reset, etc).
  await runProxy(rt);
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});