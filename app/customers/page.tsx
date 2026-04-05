import { Suspense } from "react"
import { CustomerList } from "./_components/CustomerList"

export default function CustomersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      }
    >
      <CustomerList />
    </Suspense>
  )
}
