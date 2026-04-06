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

interface Customer {
  customer_id: number
  name: string
  company_name: string
  phone: string | null
  email: string | null
  assigned_user: { user_id: number; name: string } | null
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

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function CustomerList() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [role, setRole] = useState<"sales" | "manager" | null>(null)
  const [salesUsers, setSalesUsers] = useState<SalesUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // フォームの状態
  const [formName, setFormName] = useState("")
  const [formCompanyName, setFormCompanyName] = useState("")
  const [formAssignedUserId, setFormAssignedUserId] = useState("")

  // ─── URL クエリパラメータとフォームを同期 ─────────────────────────────────────

  useEffect(() => {
    setFormName(searchParams.get("name") ?? "")
    setFormCompanyName(searchParams.get("company_name") ?? "")
    setFormAssignedUserId(searchParams.get("assigned_user_id") ?? "")
  }, [searchParams])

  // ─── 認証チェック & 担当営業リスト取得 ───────────────────────────────────────

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

    // 担当営業セレクトボックス用に営業ユーザーを取得（403 の場合はグレースフルデグレード）
    void (async () => {
      const res = await fetch("/api/v1/users?role=sales&per_page=100", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = (await res.json()) as { data: SalesUser[] }
        setSalesUsers(json.data)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── 顧客一覧取得 ─────────────────────────────────────────────────────────────

  const fetchCustomers = useCallback(async () => {
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    const params = new URLSearchParams()
    const name = searchParams.get("name")
    const companyName = searchParams.get("company_name")
    const assignedUserId = searchParams.get("assigned_user_id")
    if (name) params.set("name", name)
    if (companyName) params.set("company_name", companyName)
    if (assignedUserId) params.set("assigned_user_id", assignedUserId)
    params.set("page", searchParams.get("page") ?? "1")
    params.set("per_page", "20")

    setLoading(true)
    setError(null)

    const res = await fetch(`/api/v1/customers?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.status === 401) {
      removeToken()
      router.replace("/login")
      return
    }

    if (!res.ok) {
      setError("顧客一覧の取得に失敗しました。")
      setLoading(false)
      return
    }

    const json = (await res.json()) as { data: Customer[]; pagination: Pagination }
    setCustomers(json.data)
    setPagination(json.pagination)
    setLoading(false)
  }, [searchParams, router])

  useEffect(() => {
    void fetchCustomers()
  }, [fetchCustomers])

  // ─── 検索ハンドラ ─────────────────────────────────────────────────────────────

  function handleSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (formName) params.set("name", formName)
    if (formCompanyName) params.set("company_name", formCompanyName)
    if (formAssignedUserId) params.set("assigned_user_id", formAssignedUserId)
    params.set("page", "1")
    router.push(`/customers?${params.toString()}`)
  }

  // ─── ページ変更ハンドラ ───────────────────────────────────────────────────────

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(newPage))
    router.push(`/customers?${params.toString()}`)
  }

  // ─── レンダリング ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* ナビゲーション */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold text-foreground">顧客マスタ一覧</h1>
          {role === "manager" && (
            <Button
              type="button"
              size="sm"
              onClick={() => router.push("/customers/new")}
            >
              新規登録
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        {/* 検索フォーム */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* 顧客名 */}
              <div>
                <label
                  htmlFor="search-name"
                  className="mb-1 block text-xs text-muted-foreground"
                >
                  顧客名
                </label>
                <Input
                  id="search-name"
                  type="text"
                  placeholder="部分一致"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              {/* 会社名 */}
              <div>
                <label
                  htmlFor="search-company"
                  className="mb-1 block text-xs text-muted-foreground"
                >
                  会社名
                </label>
                <Input
                  id="search-company"
                  type="text"
                  placeholder="部分一致"
                  value={formCompanyName}
                  onChange={(e) => setFormCompanyName(e.target.value)}
                />
              </div>

              {/* 担当営業 */}
              <div>
                <label
                  htmlFor="search-assigned-user"
                  className="mb-1 block text-xs text-muted-foreground"
                >
                  担当営業
                </label>
                <select
                  id="search-assigned-user"
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={formAssignedUserId}
                  onChange={(e) => setFormAssignedUserId(e.target.value)}
                >
                  <option value="">全員</option>
                  {salesUsers.map((u) => (
                    <option key={u.user_id} value={String(u.user_id)}>
                      {u.name}
                    </option>
                  ))}
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

            {customers.length === 0 ? (
              <div className="px-4 py-10">
                <p className="text-center text-sm text-muted-foreground">
                  顧客が見つかりません
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        顧客名
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        会社名
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        電話番号
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        担当営業
                      </th>
                      {role === "manager" && (
                        <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
                          操作
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {customers.map((customer) => (
                      <tr
                        key={customer.customer_id}
                        className="transition-colors hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 text-foreground">
                          {customer.name}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {customer.company_name}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {customer.phone ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {customer.assigned_user?.name ?? "—"}
                        </td>
                        {role === "manager" && (
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() =>
                                router.push(`/customers/${customer.customer_id}/edit`)
                              }
                            >
                              詳細・編集
                            </button>
                          </td>
                        )}
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
