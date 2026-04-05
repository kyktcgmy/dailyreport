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

interface UserDetail {
  user_id: number
  name: string
  email: string
  role: "sales" | "manager"
  manager: { user_id: number; name: string } | null
}

interface ManagerUser {
  user_id: number
  name: string
}

// ─── フォームスキーマ ─────────────────────────────────────────────────────────

const baseSchema = z
  .object({
    name: z.string().min(1, "氏名は必須です"),
    email: z
      .string()
      .min(1, "メールアドレスは必須です")
      .email("有効なメールアドレスを入力してください"),
    password: z.string(),
    role: z.enum(["sales", "manager"]),
    manager_id: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "sales" && !data.manager_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "営業ロールの場合、上長の選択は必須です",
        path: ["manager_id"],
      })
    }
  })

type FormValues = z.infer<typeof baseSchema>

// ─── Props ────────────────────────────────────────────────────────────────────

type Props =
  | { mode: "new" }
  | { mode: "edit"; userIdParam: Promise<{ user_id: string }> }

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function UserForm(props: Props) {
  const router = useRouter()

  // edit モードの場合に user_id を unwrap する
  const { user_id } =
    props.mode === "edit" ? use(props.userIdParam) : { user_id: "" }
  const userId = props.mode === "edit" ? Number(user_id) : null

  const isNew = props.mode === "new"

  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [managerUsers, setManagerUsers] = useState<ManagerUser[]>([])
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
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(
      isNew
        ? baseSchema.extend({
            password: z
              .string()
              .min(8, "パスワードは8文字以上で入力してください"),
          })
        : baseSchema.extend({
            password: z
              .string()
              .refine(
                (v) => v === "" || v.length >= 8,
                "パスワードは8文字以上で入力してください"
              ),
          })
    ),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "sales",
      manager_id: "",
    },
  })

  const selectedRole = watch("role")

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
      router.replace("/users")
      return
    }

    void fetchData(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchData(token: string) {
    setPageError(null)

    try {
      if (props.mode === "edit" && userId !== null) {
        // 上長ユーザー一覧とユーザー詳細を並行取得
        const [managersRes, userRes] = await Promise.all([
          fetch("/api/v1/users?role=manager&per_page=100", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`/api/v1/users/${userId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ])

        if (managersRes.status === 401 || userRes.status === 401) {
          removeToken()
          router.replace("/login")
          return
        }
        if (!managersRes.ok) {
          setPageError("上長一覧の取得に失敗しました。")
          setLoading(false)
          return
        }
        if (userRes.status === 404) {
          setPageError("ユーザーが見つかりません。")
          setLoading(false)
          return
        }
        if (!userRes.ok) {
          setPageError("ユーザー情報の取得に失敗しました。")
          setLoading(false)
          return
        }

        const managersJson = (await managersRes.json()) as {
          data: ManagerUser[]
        }
        setManagerUsers(managersJson.data)

        const { data: u } = (await userRes.json()) as { data: UserDetail }
        reset({
          name: u.name,
          email: u.email,
          password: "",
          role: u.role as "sales" | "manager",
          manager_id: u.manager?.user_id ? String(u.manager.user_id) : "",
        })
      } else {
        // 新規モード：上長ユーザー一覧のみ取得
        const managersRes = await fetch(
          "/api/v1/users?role=manager&per_page=100",
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        )

        if (managersRes.status === 401) {
          removeToken()
          router.replace("/login")
          return
        }
        if (!managersRes.ok) {
          setPageError("上長一覧の取得に失敗しました。")
          setLoading(false)
          return
        }

        const managersJson = (await managersRes.json()) as {
          data: ManagerUser[]
        }
        setManagerUsers(managersJson.data)
      }
    } catch {
      setPageError("データの取得中にエラーが発生しました。")
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

    const body: Record<string, unknown> = {
      name: data.name,
      email: data.email,
      role: data.role,
    }
    // パスワード：新規は必須（Zodで検証済み）、編集は空でなければ送信
    if (data.password) body.password = data.password
    // manager_id：salesロールの場合のみ送信
    if (data.role === "sales" && data.manager_id) {
      body.manager_id = Number(data.manager_id)
    }

    setSubmitting(true)

    try {
      let res: Response

      if (props.mode === "edit" && userId !== null) {
        res = await fetch(`/api/v1/users/${userId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch("/api/v1/users", {
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

      router.push("/users")
    } catch {
      showToast("保存中にエラーが発生しました。")
      setSubmitting(false)
    }
  }

  // ─── 削除処理 ─────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (props.mode !== "edit" || userId === null) return
    if (deleting) return

    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    setDeleting(true)

    try {
      const res = await fetch(`/api/v1/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401) {
        removeToken()
        router.replace("/login")
        return
      }

      if (res.status === 403) {
        showToast("自分自身は削除できません。")
        setDeleting(false)
        return
      }

      if (!res.ok) {
        showToast("削除に失敗しました。")
        setDeleting(false)
        return
      }

      router.push("/users")
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
              onClick={() => router.push("/users")}
            >
              ← ユーザー一覧
            </button>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-lg font-semibold text-foreground">
              {props.mode === "new" ? "新規登録" : "ユーザー編集"}
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">読み込み中...</p>
          </div>
        ) : pageError ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{pageError}</p>
          </div>
        ) : (
          <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="space-y-5"
              noValidate
            >
              {/* 氏名 */}
              <div>
                <label
                  htmlFor="name"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  氏名
                  <span className="ml-1 text-destructive">*</span>
                </label>
                <Input
                  id="name"
                  type="text"
                  placeholder="氏名を入力"
                  aria-invalid={!!errors.name}
                  {...register("name")}
                />
                {errors.name && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.name.message}
                  </p>
                )}
              </div>

              {/* メールアドレス */}
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  メールアドレス
                  <span className="ml-1 text-destructive">*</span>
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="example@example.com"
                  aria-invalid={!!errors.email}
                  {...register("email")}
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* パスワード */}
              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  パスワード
                  {isNew && <span className="ml-1 text-destructive">*</span>}
                </label>
                <Input
                  id="password"
                  type="password"
                  placeholder={
                    isNew ? "パスワードを入力" : "変更する場合のみ入力"
                  }
                  aria-invalid={!!errors.password}
                  {...register("password")}
                />
                {errors.password && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* ロール */}
              <div>
                <p className="mb-1 block text-sm font-medium text-foreground">
                  ロール
                  <span className="ml-1 text-destructive">*</span>
                </p>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value="sales"
                      {...register("role")}
                      className="h-4 w-4"
                    />
                    営業
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value="manager"
                      {...register("role")}
                      className="h-4 w-4"
                    />
                    上長
                  </label>
                </div>
                {errors.role && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.role.message}
                  </p>
                )}
              </div>

              {/* 上長（salesロールの場合のみ表示） */}
              {selectedRole === "sales" && (
                <div>
                  <label
                    htmlFor="manager_id"
                    className="mb-1 block text-sm font-medium text-foreground"
                  >
                    上長
                  </label>
                  <select
                    id="manager_id"
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    {...register("manager_id")}
                  >
                    <option value="">選択してください</option>
                    {managerUsers.map((m) => (
                      <option key={m.user_id} value={String(m.user_id)}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  {errors.manager_id && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.manager_id.message}
                    </p>
                  )}
                </div>
              )}

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
                        <AlertDialogTitle>
                          ユーザーを削除しますか？
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          この操作は取り消せません。ユーザーアカウントが削除されます。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          disabled={deleting}
                          onClick={() => void handleDelete()}
                        >
                          {deleting ? "削除中..." : "削除する"}
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
