"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
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

interface User {
  user_id: number
  name: string
  email: string
  role: "sales" | "manager"
  manager: { user_id: number; name: string } | null
}

interface Pagination {
  total: number
  page: number
  per_page: number
  total_pages: number
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function UserList() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [users, setUsers] = useState<User[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ─── 認証チェック（manager のみ許可） ────────────────────────────────────────

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
    // manager 以外はアクセス不可
    if (payload.role !== "manager") {
      router.replace("/daily-reports")
      return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── ユーザー一覧取得 ─────────────────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    const params = new URLSearchParams()
    params.set("page", searchParams.get("page") ?? "1")
    params.set("per_page", "20")

    setLoading(true)
    setError(null)

    const res = await fetch(`/api/v1/users?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.status === 401) {
      removeToken()
      router.replace("/login")
      return
    }

    if (!res.ok) {
      setError("ユーザー一覧の取得に失敗しました。")
      setLoading(false)
      return
    }

    const json = (await res.json()) as { data: User[]; pagination: Pagination }
    setUsers(json.data)
    setPagination(json.pagination)
    setLoading(false)
  }, [searchParams, router])

  useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

  // ─── ページ変更ハンドラ ───────────────────────────────────────────────────────

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams()
    params.set("page", String(newPage))
    router.push(`/users?${params.toString()}`)
  }

  // ─── ロール表示変換 ───────────────────────────────────────────────────────────

  function formatRole(role: "sales" | "manager"): string {
    return role === "sales" ? "営業" : "上長"
  }

  // ─── レンダリング ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* ナビゲーション */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold text-foreground">ユーザーマスタ一覧</h1>
          <Button
            type="button"
            size="sm"
            onClick={() => router.push("/users/new")}
          >
            新規登録
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
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

            {users.length === 0 ? (
              <div className="px-4 py-10">
                <p className="text-center text-sm text-muted-foreground">
                  ユーザーが見つかりません
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        氏名
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        メールアドレス
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        ロール
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        上長名
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map((user) => (
                      <tr
                        key={user.user_id}
                        className="transition-colors hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 text-foreground">
                          {user.name}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {user.email}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {formatRole(user.role)}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {user.manager?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() =>
                              router.push(`/users/${user.user_id}/edit`)
                            }
                          >
                            編集
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
