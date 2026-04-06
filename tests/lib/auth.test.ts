import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt, extractBearerToken, type JwtPayload } from "../../lib/auth";

const testPayload: JwtPayload = {
  user_id: 1,
  email: "taro@example.com",
  role: "sales",
};

describe("signJwt / verifyJwt", () => {
  it("生成したトークンを検証して元のペイロードが復元される", async () => {
    const token = await signJwt(testPayload);
    const result = await verifyJwt(token);

    expect(result.user_id).toBe(testPayload.user_id);
    expect(result.email).toBe(testPayload.email);
    expect(result.role).toBe(testPayload.role);
  });

  it("managerロールのトークンも正常に生成・検証できる", async () => {
    const managerPayload: JwtPayload = {
      user_id: 5,
      email: "hanako@example.com",
      role: "manager",
    };
    const token = await signJwt(managerPayload);
    const result = await verifyJwt(token);

    expect(result.role).toBe("manager");
    expect(result.user_id).toBe(5);
  });

  it("不正なトークンを検証すると例外が投げられる", async () => {
    await expect(verifyJwt("invalid.token.here")).rejects.toThrow();
  });

  it("空文字のトークンを検証すると例外が投げられる", async () => {
    await expect(verifyJwt("")).rejects.toThrow();
  });
});

describe("extractBearerToken", () => {
  it("正常な Authorization ヘッダーからトークンを抽出する", () => {
    const token = extractBearerToken("Bearer mytoken123");
    expect(token).toBe("mytoken123");
  });

  it("Bearer プレフィックスがない場合は null を返す", () => {
    expect(extractBearerToken("mytoken123")).toBeNull();
    expect(extractBearerToken("Token mytoken123")).toBeNull();
  });

  it("ヘッダーが null の場合は null を返す", () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it("Bearer の後が空の場合は null を返す", () => {
    expect(extractBearerToken("Bearer ")).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
  });
});
