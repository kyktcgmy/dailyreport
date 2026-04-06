import { Suspense } from "react"
import { UserList } from "./_components/UserList"

export default function UsersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      }
    >
      <UserList />
    </Suspense>
  )
}
