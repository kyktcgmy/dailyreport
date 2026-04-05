import { DailyReportDetail } from "../_components/DailyReportDetail"

export default function DailyReportDetailPage({
  params,
}: {
  params: Promise<{ report_id: string }>
}) {
  return <DailyReportDetail reportIdParam={params} />
}
