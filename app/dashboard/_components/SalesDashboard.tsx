"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getToken } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

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

export function SalesDashboard() {
  const router = useRouter()

  const [todayReport, setTodayReport] = useState<DailyReportSummary | null | undefined>(
    undefined // undefined = 未取得, null = データなし
  )
  const [recentReports, setRecentReports] = useState<DailyReportSummary[]>([])
  const [totalCommentCount, setTotalCommentCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0]

    async function fetchData() {
      setLoading(true)
      setError(null)

      try {
        // 今日の日報と直近5件を並行取得
        const [todayRes, recentRes] = await Promise.all([
          fetchWithAuth(`/api/v1/daily-reports?from=${today}&to=${today}`, router),
          fetchWithAuth(`/api/v1/daily-reports?per_page=5`, router),
        ])

        if (!todayRes.ok || !recentRes.ok) {
          setError("データの取得に失敗しました。")
          return
        }

        const todayJson: DailyReportsResponse = await todayRes.json()
        const recentJson: DailyReportsResponse = await recentRes.json()

        // 今日の日報（0件 or 1件）
        setTodayReport(todayJson.data.length > 0 ? todayJson.data[0] : null)

        // 直近5件
        setRecentReports(recentJson.data)

        // 未読コメント数: 直近5件の comment_count を合算
        const total = recentJson.data.reduce((sum, r) => sum + r.comment_count, 0)
        setTotalCommentCount(total)
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
      {/* 今日の日報ステータスカード */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-foreground">今日の日報</h2>

        {todayReport === null ? (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">未作成</span>
            <Button size="sm" onClick={() => router.push("/daily-reports/new")}>
              今日の日報を作成
            </Button>
          </div>
        ) : todayReport !== undefined ? (
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-foreground">{todayReport.report_date}</p>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  todayReport.status === "submitted"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                }`}
              >
                {formatStatus(todayReport.status)}
              </span>
            </div>
            <Button size="sm" onClick={() => router.push("/daily-reports/new")}>
              今日の日報を作成
            </Button>
          </div>
        ) : null}
      </section>

      {/* 未読コメントバッジ */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-foreground">上長からのコメント</h2>
        <p className="text-sm text-foreground">
          上長からのコメント:{" "}
          <span className="font-bold text-primary">{totalCommentCount}</span> 件
        </p>
      </section>

      {/* 直近5件の日報リスト */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-foreground">直近の日報</h2>

        {recentReports.length === 0 ? (
          <p className="text-sm text-muted-foreground">日報がありません</p>
        ) : (
          <ul className="divide-y divide-border">
            {recentReports.map((report) => (
              <li key={report.report_id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => router.push(`/daily-reports/${report.report_id}`)}
                >
                  <span className="text-sm text-foreground">{report.report_date}</span>
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
