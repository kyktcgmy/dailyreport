import { describe, it, expect } from "vitest";
import { ApiError } from "../../lib/errors";

async function parseResponse(res: Response) {
  const body = await res.json();
  return { status: res.status, body };
}

describe("ApiError", () => {
  it("unauthorized() は 401 と UNAUTHORIZED コードを返す", async () => {
    const res = ApiError.unauthorized();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("invalidCredentials() は 401 と INVALID_CREDENTIALS コードを返す", async () => {
    const res = ApiError.invalidCredentials();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("forbidden() は 403 と FORBIDDEN コードを返す", async () => {
    const res = ApiError.forbidden();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("notFound() は 404 と NOT_FOUND コードを返す", async () => {
    const res = ApiError.notFound();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("validationError() は 400 と VALIDATION_ERROR コードを返す", async () => {
    const res = ApiError.validationError([
      { field: "email", message: "メールアドレスの形式が正しくありません。" },
    ]);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toHaveLength(1);
    expect(body.error.details[0].field).toBe("email");
  });

  it("validationError() は details なしでも動作する", async () => {
    const res = ApiError.validationError();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("duplicateReport() は 400 と DUPLICATE_REPORT コードを返す", async () => {
    const res = ApiError.duplicateReport();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error.code).toBe("DUPLICATE_REPORT");
  });

  it("reportAlreadySubmitted() は 403 と REPORT_ALREADY_SUBMITTED コードを返す", async () => {
    const res = ApiError.reportAlreadySubmitted();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error.code).toBe("REPORT_ALREADY_SUBMITTED");
  });

  it("cannotDeleteSelf() は 403 と CANNOT_DELETE_SELF コードを返す", async () => {
    const res = ApiError.cannotDeleteSelf();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error.code).toBe("CANNOT_DELETE_SELF");
  });

  it("internal() は 500 と INTERNAL_SERVER_ERROR コードを返す", async () => {
    const res = ApiError.internal();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
