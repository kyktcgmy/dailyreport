import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/api-handler";
import { extractBearerToken } from "@/lib/auth";
import { addToBlacklist } from "@/lib/token-blacklist";

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const token = extractBearerToken(req.headers.get("Authorization"));
  // withAuth を通過した時点でトークンは必ず存在する
  if (token) {
    addToBlacklist(token);
  }
  return new NextResponse(null, { status: 204 });
});
