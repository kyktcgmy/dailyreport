"use client"

import { type FormEvent, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getToken, removeToken } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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

interface ReportSummary {
  report_id: number
  report_date: string
  status: "draft" | "submitted"
  submitted_at: string | null
  user: { user_id: number; name: string }
  visit_count: number
  comment_count: number
}

interface Pagination {
  total: number
  page: number
  per_page: number
  total_pages: number
}

interface SalesUser {
  user_id: number
  name: string
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function getDefaultFrom(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
}

function getTodayString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function formatStatus(status: "draft" | "submitted"): string {
  return status === "draft" ? "下書き" : "提出済"
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function DailyReportList() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [reports, setReports] = useState<ReportSummary[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [role, setRole] = useState<"sales" | "manager" | null>(null)
  const [salesUsers, setSalesUsers] = useState<SalesUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // フォームの状態（URL パラメータから初期化）
  const [formFrom, setFormFrom] = useState(() => searchParams.get("from") ?? getDefaultFrom())
  const [formTo, setFormTo] = useState(() => searchParams.get("to") ?? getTodayString())
  const [formUserId, setFormUserId] = useState(() => searchParams.get("user_id") ?? "")
  const [formStatus, setFormStatus] = useState<"" | "draft" | "submitted">(() => {
    const s = searchParams.get("status")
    return s === "draft" || s === "submitted" ? s : ""
  })

  // ─── 認証チェック & 上長用担当者リスト取得 ────────────────────────────────────

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

    if (payload.role === "manager") {
      void (async () => {
        const res = await fetch("/api/v1/users?role=sales&per_page=100", {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const json = (await res.json()) as { data: SalesUser[] }
          setSalesUsers(json.data)
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── 日報一覧取得 ─────────────────────────────────────────────────────────────

  const fetchReports = useCallback(async () => {
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    const params = new URLSearchParams()
    params.set("from", searchParams.get("from") ?? getDefaultFrom())
    params.set("to", searchParams.get("to") ?? getTodayString())
    const userId = searchParams.get("user_id")
    const status = searchParams.get("status")
    if (userId) params.set("user_id", userId)
    if (status) params.set("status", status)
    params.set("page", searchParams.get("page") ?? "1")
    params.set("per_page", "20")

    setLoading(true)
    setError(null)

    const res = await fetch(`/api/v1/daily-reports?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.status === 401) {
      removeToken()
      router.replace("/login")
      return
    }

    if (!res.ok) {
      setError("日報一覧の取得に失敗しました。")
      setLoading(false)
      return
    }

    const json = (await res.json()) as { data: ReportSummary[]; pagination: Pagination }
    setReports(json.data)
    setPagination(json.pagination)
    setLoading(false)
  }, [searchParams, router])

  useEffect(() => {
    void fetchReports()
  }, [fetchReports])

  // ─── 検索ハンドラ ─────────────────────────────────────────────────────────────

  function handleSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const params = new URLSearchParams()
    params.set("from", formFrom)
    params.set("to", formTo)
    if (formUserId) params.set("user_id", formUserId)
    if (formStatus) params.set("status", formStatus)
    params.set("page", "1")
    router.push(`/daily-reports?${params.toString()}`)
  }

  // ─── ページ変更ハンドラ ───────────────────────────────────────────────────────

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(newPage))
    router.push(`/daily-reports?${params.toString()}`)
  }

  // ─── レンダリング ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* ナビゲーション */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold text-foreground">日報一覧</h1>
          {role === "sales" && (
            <Button
              type="button"
              size="sm"
              onClick={() => router.push("/daily-reports/new")}
            >
              新規作成
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        {/* 検索フォーム */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* 期間 From */}
              <div>
                <label
                  htmlFor="search-from"
                  className="mb-1 block text-xs text-muted-foreground"
                >
                  期間（From）
                </label>
                <Input
                  id="search-from"
                  type="date"
                  value={formFrom}
                  onChange={(e) => setFormFrom(e.target.value)}
                />
              </div>

              {/* 期間 To */}
              <div>
                <label
                  htmlFor="search-to"
                  className="mb-1 block text-xs text-muted-foreground"
                >
                  期間（To）
                </label>
                <Input
                  id="search-to"
                  type="date"
                  value={formTo}
                  onChange={(e) => setFormTo(e.target.value)}
                />
              </div>

              {/* 担当者（上長のみ） */}
              {role === "manager" && (
                <div>
                  <label
                    htmlFor="search-user"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    担当者
                  </label>
                  <select
                    id="search-user"
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={formUserId}
                    onChange={(e) => setFormUserId(e.target.value)}
                  >
                    <option value="">全員</option>
                    {salesUsers.map((u) => (
                      <option key={u.user_id} value={String(u.user_id)}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* ステータス */}
              <div>
                <label
                  htmlFor="search-status"
                  className="mb-1 block text-xs text-muted-foreground"
                >
                  ステータス
                </label>
                <select
                  id="search-status"
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={formStatus}
                  onChange={(e) =>
                    setFormStatus(e.target.value as "" | "draft" | "submitted")
                  }
                >
                  <option value="">全て</option>
                  <option value="draft">下書き</option>
                  <option value="submitted">提出済</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit">検索</Button>
            </div>
          </form>
        </section>

        {/* 一覧 */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">読み込み中...</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : (
          <section className="rounded-xl border border-border bg-card shadow-sm">
            {/* 件数表示 */}
            {pagination && (
              <div className="border-b border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {pagination.total === 0
                    ? "0 件"
                    : `全 ${pagination.total} 件中 ${(pagination.page - 1) * pagination.per_page + 1}〜${Math.min(pagination.page * pagination.per_page, pagination.total)} 件目`}
                </p>
              </div>
            )}

            {reports.length === 0 ? (
              <div className="px-4 py-10">
                <p className="text-center text-sm text-muted-foreground">
                  日報が見つかりません
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        日付
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        担当者
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        訪問顧客数
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
                        ステータス
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        コメント数
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reports.map((report) => (
                      <tr
                        key={report.report_id}
                        className="transition-colors hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 text-foreground">
                          {report.report_date}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {report.user.name}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground">
                          {report.visit_count}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              report.status === "submitted"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                            }`}
                          >
                            {formatStatus(report.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-foreground">
                          {report.comment_count}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() =>
                              router.push(`/daily-reports/${report.report_id}`)
                            }
                          >
                            詳細
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ページネーション */}
            {pagination && pagination.total_pages > 1 && (
              <div className="flex items-center justify-center gap-4 border-t border-border px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => handlePageChange(pagination.page - 1)}
                >
                  ← 前のページ
                </Button>
                <span className="text-xs text-muted-foreground">
                  {pagination.page} / {pagination.total_pages} ページ
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.total_pages}
                  onClick={() => handlePageChange(pagination.page + 1)}
                >
                  次のページ →
                </Button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
