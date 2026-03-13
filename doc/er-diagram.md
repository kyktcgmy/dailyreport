# ER図 - 営業日報システム

```mermaid
erDiagram
    users {
        int user_id PK
        varchar name
        varchar email
        varchar password_hash
        varchar role "sales/manager"
        int manager_id FK
        datetime deleted_at
        datetime created_at
        datetime updated_at
    }

    customers {
        int customer_id PK
        varchar name
        varchar company_name
        varchar address
        varchar phone
        varchar email
        int assigned_user_id FK
        datetime created_at
        datetime updated_at
    }

    daily_reports {
        int report_id PK
        int user_id FK
        date report_date
        varchar status "draft/submitted"
        datetime submitted_at
        datetime created_at
        datetime updated_at
    }

    visit_records {
        int visit_id PK
        int report_id FK
        int customer_id FK
        varchar visited_at
        text visit_content
        datetime created_at
        datetime updated_at
    }

    visit_attendees {
        int id PK
        int visit_id FK
        int user_id FK
    }

    problems {
        int problem_id PK
        int report_id FK
        text content
        int sort_order
        datetime created_at
        datetime updated_at
    }

    plans {
        int plan_id PK
        int report_id FK
        text content
        int sort_order
        datetime created_at
        datetime updated_at
    }

    comments {
        int comment_id PK
        varchar target_type "problem/plan"
        int target_id
        int user_id FK
        text content
        datetime created_at
    }

    users ||--o{ users : "manager_id"
    users ||--o{ customers : "assigned_user_id"
    users ||--o{ daily_reports : "user_id"
    users ||--o{ visit_attendees : "user_id"
    users ||--o{ comments : "user_id"
    daily_reports ||--o{ visit_records : "report_id"
    daily_reports ||--o{ problems : "report_id"
    daily_reports ||--o{ plans : "report_id"
    visit_records ||--o{ visit_attendees : "visit_id"
    customers ||--o{ visit_records : "customer_id"
```

## テーブル概要

| テーブル | 説明 |
|---|---|
| `users` | 営業・上長を統合管理。`role` で区別、`manager_id` で自己参照（上長関係）。論理削除対応。 |
| `customers` | 顧客マスタ。担当営業を `assigned_user_id` で紐付け。 |
| `daily_reports` | 日報本体。1ユーザー×1日=1件。`status` で下書き/提出済みを管理。 |
| `visit_records` | 訪問記録。日報に複数件紐付き、顧客マスタへFK。 |
| `visit_attendees` | 訪問の同行者（中間テーブル）。`visit_id + user_id` の複合ユニーク。 |
| `problems` | 日報の課題項目。日報に複数件紐付き。 |
| `plans` | 日報の翌日計画項目。日報に複数件紐付き。 |
| `comments` | Problem/Plan へのコメント。`target_type + target_id` のポリモーフィック構造で1テーブルに統合。 |
