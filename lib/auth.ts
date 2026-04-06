import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET 環境変数が設定されていません。");
  }
  return new TextEncoder().encode(secret);
}

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "24h";

export const UserRoleSchema = z.enum(["sales", "manager"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const JwtPayloadSchema = z.object({
  user_id: z.number(),
  email: z.string().email(),
  role: UserRoleSchema,
});
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

export async function signJwt(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(getJwtSecret());
}

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getJwtSecret());
  return JwtPayloadSchema.parse(payload);
}

export function extractBearerToken(
  authHeader: string | null
): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}
