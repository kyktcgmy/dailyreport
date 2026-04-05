import { Suspense } from "react"
import { DailyReportList } from "./_components/DailyReportList"

export default function DailyReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      }
    >
      <DailyReportList />
    </Suspense>
  )
}
