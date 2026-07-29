import { init } from "./src/db.js"
import { app } from "./server.js";

init();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));