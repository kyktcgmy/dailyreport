import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main className="flex flex-col items-center gap-6">
        <h1 className="text-3xl font-bold">営業日報システム</h1>
        <p className="text-muted-foreground">shadcn/ui Button コンポーネントのテスト</p>
        <div className="flex gap-4">
          <Button>デフォルト</Button>
          <Button variant="outline">アウトライン</Button>
          <Button variant="secondary">セカンダリ</Button>
          <Button variant="destructive">削除</Button>
        </div>
      </main>
    </div>
  );
}
