import type { Metadata } from "next"

import { LoginForm } from "./_components/LoginForm"

export const metadata: Metadata = {
  title: "ログイン | 営業日報システム",
}

export default function LoginPage() {
  return <LoginForm />
}
