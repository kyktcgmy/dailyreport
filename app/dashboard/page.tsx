"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getToken, removeToken } from "@/lib/auth-client"
import { SalesDashboard } from "./_components/SalesDashboard"
import { ManagerDashboard } from "./_components/ManagerDashboard"
import { Button } from "@/components/ui/button"

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

export default function DashboardPage() {
  const router = useRouter()
  const [role, setRole] = useState<"sales" | "manager" | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      router.replace("/login")
      return
    }

    const payload = decodeJwtPayload(token)
    if (!payload || !payload.role) {
      removeToken()
      router.replace("/login")
      return
    }

    setRole(payload.role)
    setLoading(false)
  }, [router])

  const handleLogout = () => {
    removeToken()
    router.push("/login")
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ナビゲーションエリア */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold text-foreground">営業日報システム</h1>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            ログアウト
          </Button>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        {role === "sales" && <SalesDashboard />}
        {role === "manager" && <ManagerDashboard />}
      </main>
    </div>
  )
}
