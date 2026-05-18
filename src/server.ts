import { app } from "./app";
import { env } from "./config/env";

app.listen(env.PORT, () => {
  console.log(`[server] Doux Chat Bot listening on port ${env.PORT}`);
});
