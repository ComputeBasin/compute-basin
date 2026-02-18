import "dotenv/config";
import { PORT } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(PORT, () => {
  console.log(`computebasin backend listening on http://localhost:${PORT}`);
});
