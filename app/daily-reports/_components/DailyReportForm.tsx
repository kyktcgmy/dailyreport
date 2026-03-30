"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
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
}

interface UserOption {
  user_id: number
  name: string
  role: string
}

interface DailyReportDetail {
  report_id: number
  report_date: string
  status: "draft" | "submitted"
  user: { user_id: number; name: string }
  visit_records: {
    visit_id: number
    customer: { customer_id: number; name: string; company_name: string }
    visited_at: string
    visit_content: string
    attendees: { user_id: number; name: string }[]
  }[]
  problems: { problem_id: number; content: string; sort_order: number; comments: unknown[] }[]
  plans: { plan_id: number; content: string; sort_order: number; comments: unknown[] }[]
}

// ─── Zod スキーマ ─────────────────────────────────────────────────────────────

// 「提出」時のみ適用するバリデーションスキーマ
const submitSchema = z.object({
  visit_records: z
    .array(
      z.object({
        customer_id: z
          .number({ error: "顧客を選択してください" })
          .int()
          .min(1, "顧客を選択してください"),
        visited_at: z.string(),
        visit_content: z.string().min(1, "訪問内容を入力してください"),
        attendee_user_ids: z.array(z.number()),
      })
    )
    .min(1, "訪問記録を1件以上入力してください"),
  problems: z.array(
    z.object({
      content: z.string(),
    })
  ),
  plans: z.array(
    z.object({
      content: z.string(),
    })
  ),
})

type FormValues = z.infer<typeof submitSchema>

// ─── Props ────────────────────────────────────────────────────────────────────

type Props =
  | { mode: "new" }
  | { mode: "edit"; reportIdParam: Promise<{ report_id: string }> }

// ─── ユーティリティ ───────────────────────────────────────────────────────────

/** 今日の日付を YYYY-MM-DD 形式で返す */
function getTodayString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function DailyReportForm(props: Props) {
  const router = useRouter()

  // edit モードの場合、params Promise を解決して report_id を取得
  const resolvedParams =
    props.mode === "edit" ? use(props.reportIdParam) : null
  const reportIdFromParams =
    resolvedParams ? parseInt(resolvedParams.report_id, 10) : null

  // 保存後に取得した report_id（新規作成時に POST 後に切り替え）
  const [savedReportId, setSavedReportId] = useState<number | null>(
    reportIdFromParams
  )

  const [authPayload, setAuthPayload] = useState<JwtPayload | null>(null)
  const [reportDate, setReportDate] = useState<string>(getTodayString())
  const [authorName, setAuthorName] = useState<string>("")
  const [customers, setCustomers] = useState<Customer[]>([])
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // ─── React Hook Form ─────────────────────────────────────────────────────────

  const {
    register,
    control,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(submitSchema),
    defaultValues: {
      visit_records: [
        { customer_id: 0, visited_at: "", visit_content: "", attendee_user_ids: [] },
      ],
      problems: [{ content: "" }],
      plans: [{ content: "" }],
    },
  })

  const visitRecordsArray = useFieldArray({ control, name: "visit_records" })
  const problemsArray = useFieldArray({ control, name: "problems" })
  const plansArray = useFieldArray({ control, name: "plans" })

  // ─── 認証チェック & データ取得 ────────────────────────────────────────────────

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

    // manager ロールが新規作成ページにアクセスした場合はダッシュボードへ
    if (props.mode === "new" && payload.role === "manager") {
      router.replace("/dashboard")
      return
    }

    setAuthPayload(payload)

    const headers: HeadersInit = { Authorization: `Bearer ${token}` }

    async function initialize() {
      if (!token) return

      // 担当者名の取得
      const userRes = await fetch(`/api/v1/users/${payload!.user_id}`, { headers })
      if (userRes.status === 401) {
        removeToken()
        router.replace("/login")
        return
      }
      if (userRes.ok) {
        const userJson = (await userRes.json()) as { data: { name: string; email: string } }
        setAuthorName(userJson.data.name)
      } else {
        // 取得できない場合は email を表示
        setAuthorName(payload!.email)
      }

      // 顧客一覧の取得
      const custRes = await fetch("/api/v1/customers?limit=100", { headers })
      if (custRes.status === 401) {
        removeToken()
        router.replace("/login")
        return
      }
      if (custRes.ok) {
        const custJson = (await custRes.json()) as { data: Customer[] }
        setCustomers(custJson.data)
      }

      // 同行者一覧の取得（manager 専用 API: 403 の場合はグレースフルデグレード）
      const usersRes = await fetch("/api/v1/users?limit=100", { headers })
      if (usersRes.status === 401) {
        removeToken()
        router.replace("/login")
        return
      }
      if (usersRes.ok) {
        const usersJson = (await usersRes.json()) as { data: UserOption[] }
        setUserOptions(usersJson.data)
      }
      // 403 またはその他エラーの場合は userOptions=[] のまま（グレースフルデグレード）

      // 編集モード: 既存日報のデータをプリセット
      if (props.mode === "edit" && reportIdFromParams !== null) {
        const reportRes = await fetch(`/api/v1/daily-reports/${reportIdFromParams}`, { headers })
        if (reportRes.status === 401) {
          removeToken()
          router.replace("/login")
          return
        }
        if (reportRes.ok) {
          const reportJson = (await reportRes.json()) as { data: DailyReportDetail }
          const report = reportJson.data
          setReportDate(report.report_date)

          // フォームにプリセット
          setValue(
            "visit_records",
            report.visit_records.map((v) => ({
              customer_id: v.customer.customer_id,
              visited_at: v.visited_at,
              visit_content: v.visit_content,
              attendee_user_ids: v.attendees.map((a) => a.user_id),
            }))
          )
          setValue(
            "problems",
            report.problems.map((p) => ({ content: p.content }))
          )
          setValue(
            "plans",
            report.plans.map((pl) => ({ content: pl.content }))
          )
        }
      }

      setLoading(false)
    }

    void initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── トースト表示 ─────────────────────────────────────────────────────────────

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 3000)
  }

  // ─── 保存処理（下書き・提出共通） ─────────────────────────────────────────────

  async function saveReport(values: FormValues, status: "draft"): Promise<number | null> {
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return null
    }

    const body = {
      report_date: reportDate,
      status,
      visit_records: values.visit_records.map((v, i) => ({
        customer_id: v.customer_id,
        visited_at: v.visited_at,
        visit_content: v.visit_content,
        attendee_user_ids: v.attendee_user_ids,
        sort_order: i + 1,
      })),
      problems: values.problems.map((p, i) => ({
        content: p.content,
        sort_order: i + 1,
      })),
      plans: values.plans.map((pl, i) => ({
        content: pl.content,
        sort_order: i + 1,
      })),
    }

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }

    let res: Response

    if (savedReportId !== null) {
      // PUT（編集 または 新規作成後の2回目以降の保存）
      res = await fetch(`/api/v1/daily-reports/${savedReportId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      })
    } else {
      // POST（新規作成）
      res = await fetch("/api/v1/daily-reports", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    }

    if (res.status === 401) {
      removeToken()
      router.replace("/login")
      return null
    }

    if (!res.ok) {
      return null
    }

    const json = (await res.json()) as { data: { report_id: number } }
    const reportId = json.data.report_id
    setSavedReportId(reportId)
    return reportId
  }

  // ─── 下書き保存ハンドラ ───────────────────────────────────────────────────────

  async function handleSaveDraft() {
    if (submitting) return
    setSubmitting(true)

    const values = getValues()
    const reportId = await saveReport(values, "draft")

    setSubmitting(false)

    if (reportId !== null) {
      showToast("保存しました")
    }
  }

  // ─── 提出ハンドラ ─────────────────────────────────────────────────────────────

  const handleSubmitForm = handleSubmit(async (values: FormValues) => {
    if (submitting) return
    setSubmitting(true)

    // 1. 下書き保存
    const reportId = await saveReport(values, "draft")
    if (reportId === null) {
      setSubmitting(false)
      return
    }

    // 2. 提出
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    const submitRes = await fetch(`/api/v1/daily-reports/${reportId}/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })

    if (submitRes.status === 401) {
      removeToken()
      router.replace("/login")
      return
    }

    setSubmitting(false)

    if (submitRes.ok) {
      router.push(`/daily-reports/${reportId}`)
    }
  })

  // ─── レンダリング ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ナビゲーション */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold text-foreground">
            {props.mode === "new" ? "日報作成" : "日報編集"}
          </h1>
        </div>
      </header>

      {/* トースト */}
      {toast !== null && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg bg-green-50 px-4 py-2 text-green-700 shadow-md"
        >
          {toast}
        </div>
      )}

      <main className="mx-auto max-w-3xl px-4 py-6">
        <form onSubmit={handleSubmitForm} noValidate>
          {/* ─── ヘッダー情報 ─── */}
          <section className="mb-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">基本情報</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">日付</p>
                <p className="text-sm font-medium text-foreground">{reportDate}</p>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">担当者</p>
                <p className="text-sm font-medium text-foreground">{authorName}</p>
              </div>
            </div>
          </section>

          {/* ─── 訪問記録 ─── */}
          <section className="mb-6 rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">訪問記録</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  visitRecordsArray.append({
                    customer_id: 0,
                    visited_at: "",
                    visit_content: "",
                    attendee_user_ids: [],
                  })
                }
              >
                + 行追加
              </Button>
            </div>

            {/* 訪問記録が1件以上必要エラー（提出時） */}
            {errors.visit_records?.root?.message && (
              <p className="mb-2 text-xs text-destructive">
                {errors.visit_records.root.message}
              </p>
            )}
            {typeof errors.visit_records?.message === "string" && (
              <p className="mb-2 text-xs text-destructive">
                {errors.visit_records.message}
              </p>
            )}

            <div className="space-y-4">
              {visitRecordsArray.fields.map((field, index) => (
                <div
                  key={field.id}
                  className="rounded-md border border-border p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      訪問記録 {index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => visitRecordsArray.remove(index)}
                      aria-label={`訪問記録 ${index + 1} を削除`}
                    >
                      削除
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {/* 顧客セレクト */}
                    <div>
                      <label
                        htmlFor={`visit_records.${index}.customer_id`}
                        className="mb-1 block text-xs text-muted-foreground"
                      >
                        顧客 <span className="text-destructive">*</span>
                      </label>
                      <select
                        id={`visit_records.${index}.customer_id`}
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-invalid={
                          !!errors.visit_records?.[index]?.customer_id
                        }
                        {...register(`visit_records.${index}.customer_id`, {
                          valueAsNumber: true,
                        })}
                      >
                        <option value={0}>選択してください</option>
                        {customers.map((c) => (
                          <option key={c.customer_id} value={c.customer_id}>
                            {c.company_name} / {c.name}
                          </option>
                        ))}
                      </select>
                      {errors.visit_records?.[index]?.customer_id && (
                        <p className="mt-1 text-xs text-destructive">
                          {errors.visit_records[index]?.customer_id?.message}
                        </p>
                      )}
                    </div>

                    {/* 訪問時刻 */}
                    <div>
                      <label
                        htmlFor={`visit_records.${index}.visited_at`}
                        className="mb-1 block text-xs text-muted-foreground"
                      >
                        訪問時刻（HH:MM）
                      </label>
                      <Input
                        id={`visit_records.${index}.visited_at`}
                        type="text"
                        placeholder="10:00"
                        {...register(`visit_records.${index}.visited_at`)}
                      />
                    </div>

                    {/* 訪問内容 */}
                    <div>
                      <label
                        htmlFor={`visit_records.${index}.visit_content`}
                        className="mb-1 block text-xs text-muted-foreground"
                      >
                        訪問内容 <span className="text-destructive">*</span>
                      </label>
                      <textarea
                        id={`visit_records.${index}.visit_content`}
                        rows={3}
                        className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-invalid={
                          !!errors.visit_records?.[index]?.visit_content
                        }
                        {...register(`visit_records.${index}.visit_content`)}
                      />
                      {errors.visit_records?.[index]?.visit_content && (
                        <p className="mt-1 text-xs text-destructive">
                          {errors.visit_records[index]?.visit_content?.message}
                        </p>
                      )}
                    </div>

                    {/* 同行者マルチセレクト（API取得できた場合のみ表示） */}
                    {userOptions.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs text-muted-foreground">
                          同行者
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {userOptions
                            .filter((u) => u.user_id !== authPayload?.user_id)
                            .map((u) => {
                              const currentIds =
                                (getValues(
                                  `visit_records.${index}.attendee_user_ids`
                                ) as number[]) ?? []
                              const checked = currentIds.includes(u.user_id)
                              return (
                                <label
                                  key={u.user_id}
                                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                                >
                                  <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5"
                                    defaultChecked={checked}
                                    onChange={(e) => {
                                      const ids = [
                                        ...((getValues(
                                          `visit_records.${index}.attendee_user_ids`
                                        ) as number[]) ?? []),
                                      ]
                                      if (e.target.checked) {
                                        if (!ids.includes(u.user_id)) {
                                          ids.push(u.user_id)
                                        }
                                      } else {
                                        const idx = ids.indexOf(u.user_id)
                                        if (idx !== -1) ids.splice(idx, 1)
                                      }
                                      setValue(
                                        `visit_records.${index}.attendee_user_ids`,
                                        ids
                                      )
                                    }}
                                  />
                                  {u.name}
                                </label>
                              )
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ─── 課題・相談 ─── */}
          <section className="mb-6 rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">課題・相談</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => problemsArray.append({ content: "" })}
              >
                + 行追加
              </Button>
            </div>

            <div className="space-y-3">
              {problemsArray.fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <textarea
                    rows={2}
                    className="flex flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder={`課題・相談 ${index + 1}`}
                    aria-label={`課題・相談 ${index + 1}`}
                    {...register(`problems.${index}.content`)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => problemsArray.remove(index)}
                    aria-label={`課題・相談 ${index + 1} を削除`}
                  >
                    削除
                  </Button>
                </div>
              ))}
            </div>
          </section>

          {/* ─── 明日の予定 ─── */}
          <section className="mb-6 rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">明日の予定</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => plansArray.append({ content: "" })}
              >
                + 行追加
              </Button>
            </div>

            <div className="space-y-3">
              {plansArray.fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <textarea
                    rows={2}
                    className="flex flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder={`予定 ${index + 1}`}
                    aria-label={`明日の予定 ${index + 1}`}
                    {...register(`plans.${index}.content`)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => plansArray.remove(index)}
                    aria-label={`明日の予定 ${index + 1} を削除`}
                  >
                    削除
                  </Button>
                </div>
              ))}
            </div>
          </section>

          {/* ─── アクションボタン ─── */}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/dashboard")}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={handleSaveDraft}
            >
              下書き保存
            </Button>
            <Button type="submit" disabled={submitting}>
              提出
            </Button>
          </div>
        </form>
      </main>
    </div>
  )
}
