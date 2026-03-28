/**
 * Vitest Worker セットアップ（Worker ごとに実行）
 *
 * .env.test を各 Worker プロセスに読み込む。
 * DB の初期化・シード投入は tests/globalSetup.ts で行う。
 */
import { config } from "dotenv";
import path from "path";

// .env.test を最優先で読み込む（既存の環境変数を上書きする）
config({ path: path.resolve(process.cwd(), ".env.test"), override: true });
