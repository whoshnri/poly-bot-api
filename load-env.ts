import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(import.meta.dir, "../.env") });