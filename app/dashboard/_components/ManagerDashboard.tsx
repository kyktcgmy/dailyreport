"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getToken } from "@/lib/auth-client"

interface DailyReportSummary {
  report_id: number
  report_date: string
  status: "draft" | "submitted"
  submitted_at: string | null
  user: {
    user_id: number
    name: string
  }
  visit_count: number
  comment_count: number
}

interface DailyReportsResponse {
  data: DailyReportSummary[]
  pagination: {
    total: number
    page: number
    per_page: number
    total_pages: number
  }
}

/** JWT 付き fetch ヘルパー。401 時は /login へリダイレクト */
async function fetchWithAuth(
  url: string,
  router: ReturnType<typeof useRouter>
): Promise<Response> {
  const token = getToken()
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token ?? ""}`,
    },
  })
  if (response.status === 401) {
    router.replace("/login")
  }
  return response
}

function formatStatus(status: "draft" | "submitted"): string {
  return status === "draft" ? "下書き" : "提出済"
}

export function ManagerDashboard() {
  const router = useRouter()

  const [uncommentedCount, setUncommentedCount] = useState(0)
  const [todayReports, setTodayReports] = useState<DailyReportSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0]

    async function fetchData() {
      setLoading(true)
      setError(null)

      try {
        // 提出済み日報全件と当日日報を並行取得
        const [submittedRes, todayRes] = await Promise.all([
          fetchWithAuth(`/api/v1/daily-reports?status=submitted`, router),
          fetchWithAuth(`/api/v1/daily-reports?from=${today}&to=${today}`, router),
        ])

        if (!submittedRes.ok || !todayRes.ok) {
          setError("データの取得に失敗しました。")
          return
        }

        const submittedJson: DailyReportsResponse = await submittedRes.json()
        const todayJson: DailyReportsResponse = await todayRes.json()

        // comment_count === 0 の提出済み日報数
        const noCommentCount = submittedJson.data.filter(
          (r) => r.comment_count === 0
        ).length
        setUncommentedCount(noCommentCount)

        // 当日の日報一覧
        setTodayReports(todayJson.data)
      } catch {
        setError("データの取得中にエラーが発生しました。")
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [router])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">読み込み中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* コメント未記入の提出済み日報数 */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-foreground">
          コメント未記入の提出済み日報
        </h2>
        <p className="text-sm text-foreground">
          未コメント:{" "}
          <span
            className={`font-bold ${
              uncommentedCount > 0 ? "text-destructive" : "text-primary"
            }`}
          >
            {uncommentedCount}
          </span>{" "}
          件
        </p>
      </section>

      {/* 部下の日報提出状況（当日） */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-foreground">
          本日の日報提出状況
        </h2>

        {todayReports.length === 0 ? (
          <p className="text-sm text-muted-foreground">本日の提出はありません</p>
        ) : (
          <ul className="divide-y divide-border">
            {todayReports.map((report) => (
              <li key={report.report_id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => router.push(`/daily-reports/${report.report_id}`)}
                >
                  <span className="text-sm font-medium text-foreground">
                    {report.user.name}
                  </span>
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      report.status === "submitted"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    }`}
                  >
                    {formatStatus(report.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
