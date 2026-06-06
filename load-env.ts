import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const moduleDir = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(moduleDir, ".env") });
