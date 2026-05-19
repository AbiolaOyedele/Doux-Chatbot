import { app } from "./app";
import { env } from "./config/env";
import { startFlyerCleanup } from "./lib/flyer-storage";

startFlyerCleanup();

app.listen(env.PORT, () => {
  console.log(`[server] Doux Chat Bot listening on port ${env.PORT}`);
});
