# GitHub Actions CI/CD セットアップ手順

## 必要なGitHub Secretsの設定

以下のSecretsをGitHubリポジトリの Settings > Secrets and variables > Actions に登録してください。

| Secret名 | 説明 |
|---|---|
| `GCP_PROJECT_ID` | Google CloudのプロジェクトID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity ProviderのリソースID |
| `GCP_SERVICE_ACCOUNT` | デプロイ用サービスアカウントのメールアドレス |
| `CLOUD_SQL_INSTANCE_CONNECTION_NAME` | Cloud SQL接続名（`project:region:instance`形式） |

## Google Cloud側の事前設定

### 1. Artifact Registryリポジトリの作成

```bash
gcloud artifacts repositories create dailyreport \
  --repository-format=docker \
  --location=asia-northeast1 \
  --description="Daily Report App Docker Images"
```

### 2. Secret Managerへの環境変数登録

```bash
# DATABASE_URL（Cloud SQL接続文字列）
echo -n "postgresql://user:password@/dailyreport?host=/cloudsql/PROJECT:REGION:INSTANCE" \
  | gcloud secrets create DATABASE_URL --data-file=-

# JWT_SECRET
echo -n "your-production-secret-key" \
  | gcloud secrets create JWT_SECRET --data-file=-

# JWT_EXPIRES_IN
echo -n "7d" \
  | gcloud secrets create JWT_EXPIRES_IN --data-file=-

# NEXTAUTH_URL
echo -n "https://your-cloud-run-url" \
  | gcloud secrets create NEXTAUTH_URL --data-file=-
```

### 3. Workload Identity Federationの設定

GitHub ActionsからGCPへのキーレス認証を設定します。

```bash
# Workload Identity Poolの作成
gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Actions Pool"

# Workload Identity Providerの作成
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# サービスアカウントへのバインディング
gcloud iam service-accounts add-iam-policy-binding \
  YOUR_SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/OWNER/REPO"
```

### 4. サービスアカウントに必要なロールを付与

```bash
SA="YOUR_SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com"

# Cloud Run デプロイ権限
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${SA}" \
  --role="roles/run.admin"

# Artifact Registry書き込み権限
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${SA}" \
  --role="roles/artifactregistry.writer"

# Secret Manager読み取り権限
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor"

# Cloud SQL接続権限
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${SA}" \
  --role="roles/cloudsql.client"
```

## Cloud RunとCloud SQLの接続

Cloud Runサービスは Cloud SQL Auth Proxy を使ってCloud SQLに接続します。
`DATABASE_URL` の形式:

```
postgresql://USER:PASSWORD@/DATABASE?host=/cloudsql/PROJECT:REGION:INSTANCE
```
