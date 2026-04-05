import { DailyReportForm } from "../../_components/DailyReportForm"

export default function EditDailyReportPage({
  params,
}: {
  params: Promise<{ report_id: string }>
}) {
  return <DailyReportForm mode="edit" reportIdParam={params} />
}
