"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { getToken, removeToken } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

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
  address: string | null
  phone: string | null
  email: string | null
  assigned_user: { user_id: number; name: string } | null
}

interface SalesUser {
  user_id: number
  name: string
}

// ─── フォームスキーマ ─────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1, "顧客名は必須です"),
  company_name: z.string().min(1, "会社名は必須です"),
  address: z.string(),
  phone: z.string(),
  email: z.string(),
  assigned_user_id: z.string(),
})

type FormValues = z.infer<typeof schema>

// ─── Props ────────────────────────────────────────────────────────────────────

type Props =
  | { mode: "new" }
  | { mode: "edit"; customerIdParam: Promise<{ customer_id: string }> }

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function CustomerForm(props: Props) {
  const router = useRouter()

  // edit モードの場合に customer_id を unwrap する
  const { customer_id } =
    props.mode === "edit" ? use(props.customerIdParam) : { customer_id: "" }
  const customerId = props.mode === "edit" ? Number(customer_id) : null

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [salesUsers, setSalesUsers] = useState<SalesUser[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      company_name: "",
      address: "",
      phone: "",
      email: "",
      assigned_user_id: "",
    },
  })

  // ─── 認証チェック & 初期データ取得 ────────────────────────────────────────────

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
    // manager ロール以外はアクセス不可
    if (payload.role !== "manager") {
      router.replace("/customers")
      return
    }

    void fetchData(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchData(token: string) {
    setError(null)

    try {
      if (props.mode === "edit" && customerId !== null) {
        // 営業ユーザー一覧と顧客詳細を並行取得
        const [usersRes, customerRes] = await Promise.all([
          fetch("/api/v1/users?role=sales&per_page=100", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`/api/v1/customers/${customerId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ])

        if (usersRes.status === 401 || customerRes.status === 401) {
          removeToken()
          router.replace("/login")
          return
        }
        if (!usersRes.ok) {
          setError("ユーザー一覧の取得に失敗しました。")
          setLoading(false)
          return
        }
        if (customerRes.status === 404) {
          setError("顧客が見つかりません。")
          setLoading(false)
          return
        }
        if (!customerRes.ok) {
          setError("顧客情報の取得に失敗しました。")
          setLoading(false)
          return
        }

        const usersJson = (await usersRes.json()) as { data: SalesUser[] }
        setSalesUsers(usersJson.data)

        const c = (await customerRes.json()) as Customer
        reset({
          name: c.name,
          company_name: c.company_name,
          address: c.address ?? "",
          phone: c.phone ?? "",
          email: c.email ?? "",
          assigned_user_id: c.assigned_user?.user_id
            ? String(c.assigned_user.user_id)
            : "",
        })
      } else {
        // 新規モード：営業ユーザー一覧のみ取得
        const usersRes = await fetch("/api/v1/users?role=sales&per_page=100", {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (usersRes.status === 401) {
          removeToken()
          router.replace("/login")
          return
        }
        if (!usersRes.ok) {
          setError("ユーザー一覧の取得に失敗しました。")
          setLoading(false)
          return
        }

        const usersJson = (await usersRes.json()) as { data: SalesUser[] }
        setSalesUsers(usersJson.data)
      }
    } catch {
      setError("データの取得中にエラーが発生しました。")
    }

    setLoading(false)
  }

  // ─── フォーム送信 ─────────────────────────────────────────────────────────────

  async function onSubmit(data: FormValues) {
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    // 空文字のオプション項目は送信しない（バックエンドのバリデーションエラー回避）
    const body: Record<string, unknown> = {
      name: data.name,
      company_name: data.company_name,
    }
    if (data.address) body.address = data.address
    if (data.phone) body.phone = data.phone
    if (data.email) body.email = data.email
    if (data.assigned_user_id)
      body.assigned_user_id = Number(data.assigned_user_id)

    setSubmitting(true)

    try {
      let res: Response

      if (props.mode === "edit" && customerId !== null) {
        res = await fetch(`/api/v1/customers/${customerId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch("/api/v1/customers", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        })
      }

      if (res.status === 401) {
        removeToken()
        router.replace("/login")
        return
      }

      if (!res.ok) {
        showToast("保存に失敗しました。入力内容を確認してください。")
        setSubmitting(false)
        return
      }

      router.push("/customers")
    } catch {
      showToast("保存中にエラーが発生しました。")
      setSubmitting(false)
    }
  }

  // ─── 削除処理 ─────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (props.mode !== "edit" || customerId === null) return

    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    setDeleting(true)

    try {
      const res = await fetch(`/api/v1/customers/${customerId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401) {
        removeToken()
        router.replace("/login")
        return
      }

      if (!res.ok) {
        showToast("削除に失敗しました。")
        setDeleting(false)
        return
      }

      router.push("/customers")
    } catch {
      showToast("削除中にエラーが発生しました。")
      setDeleting(false)
    }
  }

  // ─── レンダリング ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* ナビゲーション */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => router.push("/customers")}
            >
              ← 顧客一覧
            </button>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-lg font-semibold text-foreground">
              {props.mode === "new" ? "新規登録" : "顧客編集"}
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">読み込み中...</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : (
          <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
              {/* 顧客名 */}
              <div>
                <label
                  htmlFor="name"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  顧客名
                  <span className="ml-1 text-destructive">*</span>
                </label>
                <Input
                  id="name"
                  type="text"
                  placeholder="顧客名を入力"
                  aria-invalid={!!errors.name}
                  {...register("name")}
                />
                {errors.name && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.name.message}
                  </p>
                )}
              </div>

              {/* 会社名 */}
              <div>
                <label
                  htmlFor="company_name"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  会社名
                  <span className="ml-1 text-destructive">*</span>
                </label>
                <Input
                  id="company_name"
                  type="text"
                  placeholder="会社名を入力"
                  aria-invalid={!!errors.company_name}
                  {...register("company_name")}
                />
                {errors.company_name && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.company_name.message}
                  </p>
                )}
              </div>

              {/* 住所 */}
              <div>
                <label
                  htmlFor="address"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  住所
                </label>
                <Input
                  id="address"
                  type="text"
                  placeholder="住所を入力"
                  {...register("address")}
                />
              </div>

              {/* 電話番号 */}
              <div>
                <label
                  htmlFor="phone"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  電話番号
                </label>
                <Input
                  id="phone"
                  type="text"
                  placeholder="000-0000-0000"
                  {...register("phone")}
                />
              </div>

              {/* メールアドレス */}
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  メールアドレス
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="example@example.com"
                  {...register("email")}
                />
              </div>

              {/* 担当営業 */}
              <div>
                <label
                  htmlFor="assigned_user_id"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  担当営業
                </label>
                <select
                  id="assigned_user_id"
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  {...register("assigned_user_id")}
                >
                  <option value="">未設定</option>
                  {salesUsers.map((u) => (
                    <option key={u.user_id} value={String(u.user_id)}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* ボタン群 */}
              <div className="flex items-center justify-between pt-2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? "保存中..." : "保存"}
                </Button>

                {/* 削除ボタン（編集モードのみ） */}
                {props.mode === "edit" && (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={deleting}
                        >
                          {deleting ? "削除中..." : "削除"}
                        </Button>
                      }
                    />
                    <AlertDialogContent size="sm">
                      <AlertDialogHeader>
                        <AlertDialogTitle>顧客を削除しますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                          この操作は取り消せません。顧客情報が完全に削除されます。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => void handleDelete()}
                        >
                          削除する
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </form>
          </section>
        )}
      </main>

      {/* トースト通知 */}
      {toast && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed bottom-4 right-4 z-50 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  )
}
