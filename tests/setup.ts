/**
 * Vitest Worker セットアップ
 * .env.test を各 Worker プロセスに読み込む。
 */
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(process.cwd(), ".env.test"), override: true });
