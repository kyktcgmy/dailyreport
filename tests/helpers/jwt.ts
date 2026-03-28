import jwt from "jsonwebtoken";

export type Role = "sales" | "manager";

export interface TokenPayload {
  userId: number;
  email: string;
  role: Role;
}

/**
 * テスト用JWTトークンを生成する。
 * JWT_SECRET は .env.test の値を使用する。
 */
export function generateTestToken(payload: TokenPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET が設定されていません。.env.test を確認してください。");
  }
  const expiresIn = process.env.JWT_EXPIRES_IN ?? "1h";
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

/**
 * テストユーザーごとの固定ペイロード。
 * DB のシードデータと一致させる（userId は seed 投入後に決まるため、
 * ここでは email と role だけ固定し、userId は引数で渡す）。
 */
export function generateSalesToken(userId: number, email = "yamada@example.com"): string {
  return generateTestToken({ userId, email, role: "sales" });
}

export function generateManagerToken(userId: number, email = "hanako@example.com"): string {
  return generateTestToken({ userId, email, role: "manager" });
}
