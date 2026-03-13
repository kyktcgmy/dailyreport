# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 営業日報システム

## プロジェクト概要

営業担当者が日々の訪問記録・課題・翌日の予定を報告し、上長がコメントできるWebアプリケーション。

## 使用技術

| カテゴリ | 技術 |
|---|---|
| 言語 | TypeScript |
| フレームワーク | Next.js (App Router) |
| UIコンポーネント | shadcn/ui + Tailwind CSS |
| APIスキーマ定義 | OpenAPI（Zodによる検証） |
| DBスキーマ定義 | Prisma |
| テスト | Vitest |
| デプロイ | Google Cloud Run |

## 設計ドキュメント

| ファイル | 内容 |
|---|---|
| `doc/screen-definition.md` | 全9画面の項目定義・アクション・画面遷移図 |
| `doc/api-specification.md` | RESTful API仕様（エンドポイント・リクエスト・レスポンス） |
| `doc/test-specification.md` | APIテスト・E2Eテスト・シナリオテストのテストケース一覧 |
| `doc/er-diagram.md` | ER図（Mermaid形式）・テーブル概要 |

### 設計書の記載規則

#### screen-definition.md
- 画面IDは `SCR-XXX`（3桁連番）で採番する
- 各画面に **概要・項目定義・アクション** を必ず記載する
- 項目定義テーブルのカラム: `項目名 | 種別 | 必須 | 備考`
- アクションテーブルのカラム: `アクション | 処理 | 遷移先`
- ロール制限がある操作は対象ロールを明記する
- 画面追加時は末尾の **画面遷移図（Mermaid flowchart）** も更新する

#### api-specification.md
- エンドポイントは `メソッド /パス` の形式で記載する
- 各エンドポイントに **リクエスト・レスポンス（JSON例）・バリデーション・権限** を記載する
- エラーレスポンスは `error.code` に定義済みのエラーコード一覧から使用する
- 新しいエラーコードを追加した場合は末尾の **エラーコード一覧** に追記する
- ページネーションが必要な一覧APIは `pagination` オブジェクトをレスポンスに含める

#### test-specification.md
- テストIDの採番ルール:
  - APIテスト: `カテゴリ略称-XXX`（例: `AUTH-001`, `DR-001`, `CST-001`, `USR-001`）
  - E2Eテスト: `E2E-SCR画面ID-XXX`（例: `E2E-SCR001-001`）
  - シナリオテスト: `SCN-XXX`
- 各テストケースに **テストケース名・入力・期待結果** を必ず記載する
- 権限テストは営業（sales）・上長（manager）の両ロールで網羅する
- 異常系テストは **バリデーションエラー・権限エラー・Not Found** を最低限カバーする

## ドメイン設計の重要な決定事項

### エンティティ構造

詳細なER図は [`doc/er-diagram.md`](./doc/er-diagram.md) を参照。

- **ユーザー（users）**: 営業・上長を1テーブルで管理し `role` カラムで区別。`manager_id` による自己参照で上長関係を表現。論理削除対応（`deleted_at`）。
- **顧客（customers）**: 顧客マスタ。`assigned_user_id` で担当営業を紐付け。
- **日報（daily_reports）**: 1ユーザー × 1日 = 1件。`status: draft | submitted` で下書き/提出済みを管理。
- **訪問記録（visit_records）**: 日報に対して複数件。顧客マスタへのFK。
- **訪問参加者（visit_attendees）**: `visit_id + user_id` の中間テーブルで複数同行者を管理。
- **課題（problems）**: 日報に対して複数件。`sort_order` で表示順を管理。
- **計画（plans）**: 日報に対して複数件。`sort_order` で表示順を管理。
- **コメント（comments）**: ProblemとPlanへのコメントをポリモーフィック構造（`target_type + target_id`）で1テーブルに統合。

### 権限制御
- `sales` ロール: 自分の日報のCRUD、顧客・ユーザー一覧の参照のみ
- `manager` ロール: 部下の日報閲覧、Problem/Planへのコメント、マスタデータのCRUD

### APIの設計方針
- ベースURL: `/api/v1`
- 認証: JWT（`Authorization: Bearer <token>`）
- 日報の提出は `POST /daily-reports/:id/submit` を専用エンドポイントとして分離（`PUT` による編集と区別）
- ユーザー削除は論理削除（訪問記録・日報の履歴を保持するため）
