"use client"

import { use, useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getToken, removeToken } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

// ─── JWT ──────────────────────────────────────────────────────────────────────

interface JwtPayload {
  user_id: number
  email: string
  role: "sales" | "manager"
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const base64 = token.split(".")[1]
    const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"))
    return JSON.parse(json) as JwtPayload
  } catch {
    return null
  }
}

// ─── API 型定義 ───────────────────────────────────────────────────────────────

interface Comment {
  comment_id: number
  commenter: { user_id: number; name: string }
  content: string
  created_at: string
}

interface DailyReportDetail {
  report_id: number
  report_date: string
  status: "draft" | "submitted"
  submitted_at: string | null
  user: { user_id: number; name: string }
  visit_records: {
    visit_id: number
    customer: { customer_id: number; name: string; company_name: string }
    visited_at: string
    visit_content: string
    attendees: { user_id: number; name: string }[]
  }[]
  problems: {
    problem_id: number
    content: string
    sort_order: number
    comments: Comment[]
  }[]
  plans: {
    plan_id: number
    content: string
    sort_order: number
    comments: Comment[]
  }[]
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function formatStatus(status: "draft" | "submitted"): string {
  return status === "draft" ? "下書き" : "提出済"
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  reportIdParam: Promise<{ report_id: string }>
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function DailyReportDetail({ reportIdParam }: Props) {
  const router = useRouter()
  const { report_id } = use(reportIdParam)
  const reportId = report_id

  const [report, setReport] = useState<DailyReportDetail | null>(null)
  const [role, setRole] = useState<"sales" | "manager" | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({})
  const [commentSubmitting, setCommentSubmitting] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<string | null>(null)

  // ─── データ取得 ───────────────────────────────────────────────────────────────

  const fetchReport = useCallback(async () => {
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    const res = await fetch(`/api/v1/daily-reports/${reportId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.status === 401) {
      removeToken()
      router.replace("/login")
      return
    }

    if (!res.ok) {
      setError("日報の取得に失敗しました。")
      setLoading(false)
      return
    }

    const json = (await res.json()) as { data: DailyReportDetail }
    setReport(json.data)
    setLoading(false)
  }, [reportId, router])

  // ─── 認証チェック & 初期ロード ────────────────────────────────────────────────

  useEffect(() => {
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    const payload = decodeJwtPayload(token)
    if (!payload) {
      removeToken()
      router.replace("/login")
      return
    }

    setRole(payload.role)
    void fetchReport()
  }, [fetchReport, router])

  // ─── トースト表示 ─────────────────────────────────────────────────────────────

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 3000)
  }

  // ─── コメント送信ハンドラ ─────────────────────────────────────────────────────

  async function handleCommentSubmit(type: "problem" | "plan", targetId: number) {
    const key = `${type}_${targetId}`
    const content = (commentInputs[key] ?? "").trim()
    if (!content) return

    setCommentSubmitting((prev) => ({ ...prev, [key]: true }))

    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    const url =
      type === "problem"
        ? `/api/v1/problems/${targetId}/comments`
        : `/api/v1/plans/${targetId}/comments`

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content }),
    })

    setCommentSubmitting((prev) => ({ ...prev, [key]: false }))

    if (res.status === 401) {
      removeToken()
      router.replace("/login")
      return
    }

    if (res.ok) {
      setCommentInputs((prev) => ({ ...prev, [key]: "" }))
      await fetchReport()
    } else {
      showToast("コメントの送信に失敗しました。もう一度お試しください。")
    }
  }

  // ─── レンダリング ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">読み込み中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  if (!report) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      {/* トースト */}
      {toast !== null && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg bg-destructive/10 px-4 py-2 text-destructive shadow-md"
        >
          {toast}
        </div>
      )}

      {/* ─── ヘッダー ─── */}
      <header className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold text-foreground">日報詳細</h1>
          <div className="flex items-center gap-2">
            {role === "sales" && report.status === "draft" && (
              <Button
                type="button"
                onClick={() => router.push(`/daily-reports/${reportId}/edit`)}
              >
                編集
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/daily-reports")}
            >
              一覧へ戻る
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* ─── 基本情報 ─── */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">基本情報</h2>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-muted-foreground">日付</dt>
              <dd className="mt-1 text-sm font-medium text-foreground">{report.report_date}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">担当者</dt>
              <dd className="mt-1 text-sm font-medium text-foreground">{report.user.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">ステータス</dt>
              <dd className="mt-1">
                <span
                  className={
                    report.status === "submitted"
                      ? "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                  }
                >
                  {formatStatus(report.status)}
                </span>
              </dd>
            </div>
            {report.submitted_at !== null && (
              <div>
                <dt className="text-xs text-muted-foreground">提出日時</dt>
                <dd className="mt-1 text-sm font-medium text-foreground">
                  {formatDateTime(report.submitted_at)}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* ─── 訪問記録 ─── */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">訪問記録</h2>
          {report.visit_records.length === 0 ? (
            <p className="text-sm text-muted-foreground">訪問記録はありません</p>
          ) : (
            <div className="space-y-4">
              {report.visit_records.map((v) => (
                <div key={v.visit_id} className="rounded-md border border-border p-4">
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">顧客</dt>
                      <dd className="mt-0.5 text-sm text-foreground">
                        {v.customer.company_name} / {v.customer.name}
                      </dd>
                    </div>
                    {v.visited_at && (
                      <div>
                        <dt className="text-xs text-muted-foreground">訪問時刻</dt>
                        <dd className="mt-0.5 text-sm text-foreground">{v.visited_at}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-xs text-muted-foreground">訪問内容</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
                        {v.visit_content}
                      </dd>
                    </div>
                    {v.attendees.length > 0 && (
                      <div>
                        <dt className="text-xs text-muted-foreground">同行者</dt>
                        <dd className="mt-0.5 text-sm text-foreground">
                          {v.attendees.map((a) => a.name).join(", ")}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── 課題・相談 ─── */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">課題・相談</h2>
          {report.problems.length === 0 ? (
            <p className="text-sm text-muted-foreground">課題・相談はありません</p>
          ) : (
            <div className="space-y-4">
              {report.problems.map((problem) => {
                const key = `problem_${problem.problem_id}`
                return (
                  <div key={problem.problem_id} className="rounded-md border border-border p-4">
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {problem.content}
                    </p>

                    {/* コメント一覧 */}
                    {problem.comments.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {problem.comments.map((comment) => (
                          <div
                            key={comment.comment_id}
                            className="rounded-md bg-muted/50 px-3 py-2"
                          >
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-medium">{comment.commenter.name}</span>
                              <span>{formatDateTime(comment.created_at)}</span>
                            </div>
                            <p className="mt-1 text-sm text-foreground">{comment.content}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* コメント入力（manager のみ） */}
                    {role === "manager" && (
                      <div className="mt-3 flex gap-2">
                        <textarea
                          rows={2}
                          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                          placeholder="コメントを入力"
                          aria-label={`課題 ${problem.problem_id} へのコメント`}
                          value={commentInputs[key] ?? ""}
                          onChange={(e) =>
                            setCommentInputs((prev) => ({
                              ...prev,
                              [key]: e.target.value,
                            }))
                          }
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="self-end"
                          disabled={
                            !(commentInputs[key] ?? "").trim() ||
                            (commentSubmitting[key] ?? false)
                          }
                          onClick={() =>
                            void handleCommentSubmit("problem", problem.problem_id)
                          }
                        >
                          {commentSubmitting[key] ? "送信中..." : "コメントを送信"}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ─── 明日の予定 ─── */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">明日の予定</h2>
          {report.plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">明日の予定はありません</p>
          ) : (
            <div className="space-y-4">
              {report.plans.map((plan) => {
                const key = `plan_${plan.plan_id}`
                return (
                  <div key={plan.plan_id} className="rounded-md border border-border p-4">
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {plan.content}
                    </p>

                    {/* コメント一覧 */}
                    {plan.comments.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {plan.comments.map((comment) => (
                          <div
                            key={comment.comment_id}
                            className="rounded-md bg-muted/50 px-3 py-2"
                          >
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-medium">{comment.commenter.name}</span>
                              <span>{formatDateTime(comment.created_at)}</span>
                            </div>
                            <p className="mt-1 text-sm text-foreground">{comment.content}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* コメント入力（manager のみ） */}
                    {role === "manager" && (
                      <div className="mt-3 flex gap-2">
                        <textarea
                          rows={2}
                          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                          placeholder="コメントを入力"
                          aria-label={`予定 ${plan.plan_id} へのコメント`}
                          value={commentInputs[key] ?? ""}
                          onChange={(e) =>
                            setCommentInputs((prev) => ({
                              ...prev,
                              [key]: e.target.value,
                            }))
                          }
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="self-end"
                          disabled={
                            !(commentInputs[key] ?? "").trim() ||
                            (commentSubmitting[key] ?? false)
                          }
                          onClick={() =>
                            void handleCommentSubmit("plan", plan.plan_id)
                          }
                        >
                          {commentSubmitting[key] ? "送信中..." : "コメントを送信"}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
