# API仕様書 - 営業日報システム

## 共通仕様

### ベースURL
```
/api/v1
```

### 認証
全エンドポイント（ログインを除く）はリクエストヘッダーにJWTトークンが必要。

```
Authorization: Bearer <token>
```

### 共通レスポンス形式

**成功**
```json
{
  "data": { ... }
}
```

**一覧**
```json
{
  "data": [ ... ],
  "pagination": {
    "total": 100,
    "page": 1,
    "per_page": 20,
    "total_pages": 5
  }
}
```

**エラー**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "入力内容に誤りがあります。",
    "details": [
      { "field": "email", "message": "メールアドレスの形式が正しくありません。" }
    ]
  }
}
```

### 共通HTTPステータスコード

| コード | 意味 |
|---|---|
| 200 | OK |
| 201 | Created |
| 204 | No Content（削除成功） |
| 400 | Bad Request（バリデーションエラー） |
| 401 | Unauthorized（未認証） |
| 403 | Forbidden（権限なし） |
| 404 | Not Found |
| 500 | Internal Server Error |

---

## 1. 認証 (Auth)

### POST /auth/login
ログイン。JWTトークンを返す。

**リクエスト**
```json
{
  "email": "taro@example.com",
  "password": "password123"
}
```

**レスポンス `200`**
```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "user_id": 1,
      "name": "山田 太郎",
      "email": "taro@example.com",
      "role": "sales"
    }
  }
}
```

**エラー `401`**
```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "メールアドレスまたはパスワードが正しくありません。"
  }
}
```

---

### POST /auth/logout
ログアウト。トークンを無効化する。

**レスポンス `204`**

---

## 2. 日報 (Daily Reports)

### GET /daily-reports
日報一覧を取得する。

**クエリパラメータ**

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| from | string (YYYY-MM-DD) | - | 期間開始日。デフォルト：当月初日 |
| to | string (YYYY-MM-DD) | - | 期間終了日。デフォルト：本日 |
| user_id | integer | - | 担当者絞り込み。上長のみ指定可 |
| status | string | - | `draft` / `submitted` |
| page | integer | - | ページ番号。デフォルト：1 |
| per_page | integer | - | 1ページ件数。デフォルト：20 |

**レスポンス `200`**
```json
{
  "data": [
    {
      "report_id": 1,
      "report_date": "2026-03-10",
      "status": "submitted",
      "submitted_at": "2026-03-10T18:00:00Z",
      "user": {
        "user_id": 1,
        "name": "山田 太郎"
      },
      "visit_count": 3,
      "comment_count": 2
    }
  ],
  "pagination": {
    "total": 45,
    "page": 1,
    "per_page": 20,
    "total_pages": 3
  }
}
```

---

### POST /daily-reports
日報を新規作成する。営業ロールのみ。

**リクエスト**
```json
{
  "report_date": "2026-03-10",
  "status": "draft",
  "visit_records": [
    {
      "customer_id": 10,
      "visited_at": "10:00",
      "visit_content": "新製品のデモを実施。好感触。",
      "attendee_user_ids": [2, 3]
    }
  ],
  "problems": [
    {
      "content": "価格について競合他社との比較を求められた。",
      "sort_order": 1
    }
  ],
  "plans": [
    {
      "content": "見積書を作成して送付する。",
      "sort_order": 1
    }
  ]
}
```

**レスポンス `201`**
```json
{
  "data": {
    "report_id": 42
  }
}
```

**バリデーション**
- `report_date` は必須
- 同一ユーザー・同一日付の日報が既に存在する場合は `400`
- `visit_records` が1件以上の場合、各レコードの `customer_id` と `visit_content` は必須

---

### GET /daily-reports/:report_id
日報の詳細を取得する。

**パスパラメータ**

| パラメータ | 型 | 説明 |
|---|---|---|
| report_id | integer | 日報ID |

**レスポンス `200`**
```json
{
  "data": {
    "report_id": 42,
    "report_date": "2026-03-10",
    "status": "submitted",
    "submitted_at": "2026-03-10T18:00:00Z",
    "user": {
      "user_id": 1,
      "name": "山田 太郎"
    },
    "visit_records": [
      {
        "visit_id": 101,
        "customer": {
          "customer_id": 10,
          "name": "鈴木 一郎",
          "company_name": "株式会社サンプル"
        },
        "visited_at": "10:00",
        "visit_content": "新製品のデモを実施。好感触。",
        "attendees": [
          { "user_id": 2, "name": "佐藤 次郎" },
          { "user_id": 3, "name": "田中 三郎" }
        ]
      }
    ],
    "problems": [
      {
        "problem_id": 201,
        "content": "価格について競合他社との比較を求められた。",
        "sort_order": 1,
        "comments": [
          {
            "comment_id": 301,
            "commenter": {
              "user_id": 5,
              "name": "上長 花子"
            },
            "content": "営業部の比較資料を共有します。確認してください。",
            "created_at": "2026-03-10T19:30:00Z"
          }
        ]
      }
    ],
    "plans": [
      {
        "plan_id": 401,
        "content": "見積書を作成して送付する。",
        "sort_order": 1,
        "comments": []
      }
    ]
  }
}
```

---

### PUT /daily-reports/:report_id
日報を更新する。`draft` 状態のみ更新可能。営業ロールのみ。

**リクエスト**（POST /daily-reports と同形式）

**レスポンス `200`**
```json
{
  "data": {
    "report_id": 42
  }
}
```

**エラー**
- `submitted` 状態の日報を更新しようとした場合 `403`

---

### POST /daily-reports/:report_id/submit
日報を提出する。`draft` 状態のみ実行可能。営業ロールのみ。

**リクエスト**（ボディなし）

**レスポンス `200`**
```json
{
  "data": {
    "report_id": 42,
    "status": "submitted",
    "submitted_at": "2026-03-10T18:00:00Z"
  }
}
```

**バリデーション**
- 訪問記録が1件以上あること

---

## 3. コメント (Comments)

### POST /problems/:problem_id/comments
Problemにコメントを追加する。上長ロールのみ。

**パスパラメータ**

| パラメータ | 型 | 説明 |
|---|---|---|
| problem_id | integer | ProblemのID |

**リクエスト**
```json
{
  "content": "営業部の比較資料を共有します。確認してください。"
}
```

**レスポンス `201`**
```json
{
  "data": {
    "comment_id": 301,
    "commenter": {
      "user_id": 5,
      "name": "上長 花子"
    },
    "content": "営業部の比較資料を共有します。確認してください。",
    "created_at": "2026-03-10T19:30:00Z"
  }
}
```

---

### POST /plans/:plan_id/comments
Planにコメントを追加する。上長ロールのみ。

**パスパラメータ**

| パラメータ | 型 | 説明 |
|---|---|---|
| plan_id | integer | PlanのID |

**リクエスト**
```json
{
  "content": "了解です。明後日までにお願いします。"
}
```

**レスポンス `201`**
```json
{
  "data": {
    "comment_id": 302,
    "commenter": {
      "user_id": 5,
      "name": "上長 花子"
    },
    "content": "了解です。明後日までにお願いします。",
    "created_at": "2026-03-10T19:35:00Z"
  }
}
```

---

## 4. 顧客マスタ (Customers)

### GET /customers
顧客一覧を取得する。

**クエリパラメータ**

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| name | string | - | 顧客名（部分一致） |
| company_name | string | - | 会社名（部分一致） |
| assigned_user_id | integer | - | 担当営業で絞り込み |
| page | integer | - | デフォルト：1 |
| per_page | integer | - | デフォルト：20 |

**レスポンス `200`**
```json
{
  "data": [
    {
      "customer_id": 10,
      "name": "鈴木 一郎",
      "company_name": "株式会社サンプル",
      "phone": "03-1234-5678",
      "email": "suzuki@sample.co.jp",
      "assigned_user": {
        "user_id": 1,
        "name": "山田 太郎"
      }
    }
  ],
  "pagination": {
    "total": 80,
    "page": 1,
    "per_page": 20,
    "total_pages": 4
  }
}
```

---

### POST /customers
顧客を新規登録する。上長ロールのみ。

**リクエスト**
```json
{
  "name": "鈴木 一郎",
  "company_name": "株式会社サンプル",
  "address": "東京都千代田区...",
  "phone": "03-1234-5678",
  "email": "suzuki@sample.co.jp",
  "assigned_user_id": 1
}
```

**レスポンス `201`**
```json
{
  "data": {
    "customer_id": 10
  }
}
```

---

### GET /customers/:customer_id
顧客の詳細を取得する。

**レスポンス `200`**
```json
{
  "data": {
    "customer_id": 10,
    "name": "鈴木 一郎",
    "company_name": "株式会社サンプル",
    "address": "東京都千代田区...",
    "phone": "03-1234-5678",
    "email": "suzuki@sample.co.jp",
    "assigned_user": {
      "user_id": 1,
      "name": "山田 太郎"
    },
    "created_at": "2026-01-15T09:00:00Z",
    "updated_at": "2026-03-01T10:00:00Z"
  }
}
```

---

### PUT /customers/:customer_id
顧客情報を更新する。上長ロールのみ。

**リクエスト**（POST /customers と同形式）

**レスポンス `200`**
```json
{
  "data": {
    "customer_id": 10
  }
}
```

---

### DELETE /customers/:customer_id
顧客を削除する。上長ロールのみ。

**レスポンス `204`**

---

## 5. ユーザーマスタ (Users)

### GET /users
ユーザー一覧を取得する。上長ロールのみ。

**クエリパラメータ**

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| role | string | - | `sales` / `manager` |
| page | integer | - | デフォルト：1 |
| per_page | integer | - | デフォルト：20 |

**レスポンス `200`**
```json
{
  "data": [
    {
      "user_id": 1,
      "name": "山田 太郎",
      "email": "taro@example.com",
      "role": "sales",
      "manager": {
        "user_id": 5,
        "name": "上長 花子"
      }
    }
  ],
  "pagination": {
    "total": 10,
    "page": 1,
    "per_page": 20,
    "total_pages": 1
  }
}
```

---

### POST /users
ユーザーを新規登録する。上長ロールのみ。

**リクエスト**
```json
{
  "name": "山田 太郎",
  "email": "taro@example.com",
  "password": "initialPassword123",
  "role": "sales",
  "manager_id": 5
}
```

**レスポンス `201`**
```json
{
  "data": {
    "user_id": 1
  }
}
```

**バリデーション**
- `email` は重複不可
- `role` が `sales` の場合、`manager_id` は必須

---

### GET /users/:user_id
ユーザーの詳細を取得する。上長ロールのみ。

**レスポンス `200`**
```json
{
  "data": {
    "user_id": 1,
    "name": "山田 太郎",
    "email": "taro@example.com",
    "role": "sales",
    "manager": {
      "user_id": 5,
      "name": "上長 花子"
    },
    "created_at": "2026-01-01T09:00:00Z",
    "updated_at": "2026-03-01T10:00:00Z"
  }
}
```

---

### PUT /users/:user_id
ユーザー情報を更新する。上長ロールのみ。

**リクエスト**
```json
{
  "name": "山田 太郎",
  "email": "taro@example.com",
  "password": "newPassword456",
  "role": "sales",
  "manager_id": 5
}
```
> `password` は省略時、変更しない。

**レスポンス `200`**
```json
{
  "data": {
    "user_id": 1
  }
}
```

---

### DELETE /users/:user_id
ユーザーを論理削除する。上長ロールのみ。

**レスポンス `204`**

**エラー**
- 自分自身は削除不可 `403`

---

## エラーコード一覧

| コード | 説明 |
|---|---|
| `INVALID_CREDENTIALS` | メールアドレスまたはパスワードが不正 |
| `UNAUTHORIZED` | 未認証（トークンなし・期限切れ） |
| `FORBIDDEN` | 権限不足 |
| `NOT_FOUND` | リソースが存在しない |
| `VALIDATION_ERROR` | 入力バリデーションエラー |
| `DUPLICATE_REPORT` | 同一ユーザー・同一日付の日報が既に存在する |
| `REPORT_ALREADY_SUBMITTED` | 提出済みの日報は編集不可 |
| `CANNOT_DELETE_SELF` | 自分自身のユーザーは削除不可 |
| `INTERNAL_SERVER_ERROR` | サーバー内部エラー |
