# Shaper Dashboard API Specification

Shaper는 DuckDB 기반 SQL 대시보드 플랫폼입니다.
SQL 쿼리를 API로 전송하면 자동으로 시각화 대시보드를 생성합니다.

---

## 1. Authentication

| 방식 | 포맷 | 용도 |
|---|---|---|
| **API Key** | `Authorization: Bearer shaperkey.{id}.{suffix}` | 프로그래밍 접근 (Deploy, 조회 등) |
| **JWT Token** | `Authorization: Bearer {jwt}` | 웹 UI 사용자 세션 |

### API Key 관리

```bash
# 생성 (JWT 인증 필요)
curl -X POST http://localhost:5454/api/keys \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-key"}'
# Response: {"id": "xxx", "key": "shaperkey.xxx.yyy"}

# 목록 조회
# GET /api/keys

# 삭제
# DELETE /api/keys/:id
```

### Token 교환 (API Key → JWT)

```bash
# API Key를 JWT로 교환 (변수 주입, 대시보드 제한 가능)
curl -X POST http://localhost:5454/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "token": "shaperkey.xxx.yyy",
    "dashboardId": "dash-123",
    "variables": { "region": "US", "departments": ["Sales", "Marketing"] }
  }'
# Response: {"jwt": "signed-jwt-token"}
```

---

## 2. Deploy API (대시보드 생성/수정/삭제)

**`POST /api/deploy`** — API Key 인증

여러 대시보드를 한 번에 생성/수정/삭제할 수 있는 배치 API입니다.

### Request

```json
{
  "apps": [
    {
      "operation": "create",
      "type": "dashboard",
      "data": {
        "id": "(선택) 커스텀 ID. 생략 시 자동 생성",
        "name": "Sales Dashboard",
        "path": "/dashboards/sales",
        "content": "SELECT date as XAXIS, sum(amount) as LINECHART FROM sales GROUP BY 1"
      }
    }
  ]
}
```

| operation | 필수 필드 | 설명 |
|---|---|---|
| `create` | `name`, `path`, `content` | 새 대시보드 생성 |
| `update` | `id` + 변경할 필드 | 기존 대시보드 수정 |
| `delete` | `id` | 대시보드 삭제 |

### Response (200)

```json
{
  "results": [
    {
      "operation": "create",
      "type": "dashboard",
      "id": "abc123",
      "status": "created"
    }
  ]
}
```

### curl 예시

```bash
curl -X POST http://localhost:5454/api/deploy \
  -H "Authorization: Bearer shaperkey.xxx.yyy" \
  -H "Content-Type: application/json" \
  -d '{
    "apps": [{
      "operation": "create",
      "type": "dashboard",
      "data": {
        "name": "Q4 Sales",
        "path": "/reports/",
        "content": "SELECT date as XAXIS, revenue as LINECHART FROM quarterly_sales GROUP BY 1"
      }
    }]
  }'
```

---

## 3. Dashboard CRUD APIs

| Endpoint | Method | Request Body | Response | 설명 |
|---|---|---|---|---|
| `/api/dashboards` | POST | `{name, content, path, temporary?}` | `{id}` (201) | 대시보드 생성 |
| `/api/dashboards/:id` | GET | Query params로 변수 전달 | 쿼리 실행 결과 (아래 참조) | 대시보드 렌더 |
| `/api/dashboards/:id/info` | GET | — | 메타데이터 | 정보 조회 |
| `/api/dashboards/:id/query` | POST | `{content}` | `{ok: true}` | SQL 쿼리 수정 |
| `/api/dashboards/:id/name` | POST | `{name}` | `{ok: true}` | 이름 변경 |
| `/api/dashboards/:id/visibility` | POST | `{visibility}` | `{ok: true}` | `private\|public\|password-protected` |
| `/api/dashboards/:id/password` | POST | `{password}` | `{ok: true}` | 비밀번호 설정 |
| `/api/dashboards/:id` | DELETE | — | `{ok: true}` | 삭제 |

---

## 4. Dashboard Render Response

**`GET /api/dashboards/:id`** — 쿼리를 실행하고 결과를 반환합니다.

```json
{
  "name": "Sales Dashboard",
  "visibility": "public",
  "sections": [
    {
      "title": "Monthly Revenue",
      "type": "content",
      "queries": [
        {
          "render": {
            "type": "linechart",
            "label": "Revenue Trend",
            "markLines": []
          },
          "columns": [
            { "name": "date", "type": "date", "nullable": false, "tag": "index" },
            { "name": "revenue", "type": "number", "nullable": false, "tag": "value" }
          ],
          "rows": [
            ["2024-01-01", 1000],
            ["2024-01-02", 1500]
          ]
        }
      ]
    }
  ],
  "minTimeValue": 1704067200000,
  "maxTimeValue": 1704153600000,
  "reloadAt": 0,
  "headerImage": null,
  "footerLink": null
}
```

**주요 사항:**
- 쿼리당 최대 **3000행** 반환 (QUERY_MAX_ROWS)
- `sections[].type`: `"header"` (UI 컨트롤) 또는 `"content"` (데이터 시각화)
- `columns[].type`: `string`, `number`, `boolean`, `date`, `timestamp`, `duration`, `object`, `array` 등
- `columns[].tag`: `index`, `value`, `category`, `color`, `download`, `label` 등

---

## 5. Visualization Column Tags

**Shaper는 SQL 컬럼 alias로 차트 유형을 자동 결정합니다.**

### 차트 유형별 필수 태그 조합

| 차트 | 필수 태그 | 선택 태그 | SQL 예시 |
|---|---|---|---|
| **라인 차트** | `XAXIS` + `LINECHART` | `CATEGORY`, `COLOR` | `SELECT date as XAXIS, sum(v) as LINECHART FROM t GROUP BY 1` |
| **바 차트 (가로)** | `XAXIS` + `BARCHART` | `CATEGORY`, `COLOR` | `SELECT name as XAXIS, count(*) as BARCHART FROM t GROUP BY 1` |
| **바 차트 (세로)** | `YAXIS` + `BARCHART` | `CATEGORY`, `COLOR` | `SELECT name as YAXIS, count(*) as BARCHART FROM t GROUP BY 1` |
| **스택 바 차트** | `XAXIS` + `BARCHART_STACKED` + `CATEGORY` | `COLOR` | `SELECT date as XAXIS, sum(v) as BARCHART_STACKED, type as CATEGORY FROM t GROUP BY 1, type` |
| **파이 차트** | `PIECHART` + `CATEGORY` | `COLOR` | `SELECT count(*) as PIECHART, type as CATEGORY FROM t GROUP BY type` |
| **도넛 차트** | `DONUTCHART` + `CATEGORY` | `COLOR` | `SELECT count(*) as DONUTCHART, type as CATEGORY FROM t GROUP BY type` |
| **게이지** | `GAUGE` (1행) | `RANGE`, `LABELS`, `COLORS` | `SELECT 75 as GAUGE` |
| **KPI 값** | 태그 없음, **1행 1열** | `COMPARE` | `SELECT sum(v) as total FROM t` |
| **KPI + 비교** | 1행 2열 + `COMPARE` | — | `SELECT sum(v) as total, sum(prev) as COMPARE FROM t` |
| **테이블** | 태그 없음 (기본) | `TREND` | `SELECT id, name, value FROM t LIMIT 100` |
| **드롭다운** | `DROPDOWN` | `LABEL`, `HINT` | `SELECT id as DROPDOWN, name as LABEL FROM categories` |
| **멀티 드롭다운** | `DROPDOWN_MULTI` | `LABEL`, `HINT` | `SELECT id as DROPDOWN_MULTI, name as LABEL FROM categories` |
| **날짜 선택기** | `DATEPICKER` | — | `SELECT current_date as DATEPICKER` |
| **날짜 범위** | `DATEPICKER_FROM` + `DATEPICKER_TO` | — | `SELECT '2024-01-01' as DATEPICKER_FROM, current_date as DATEPICKER_TO` |
| **입력 필드** | `INPUT` | `HINT` | `SELECT '' as INPUT` |

### 퍼센트 변형

값을 퍼센트로 포맷: `LINECHART_PERCENT`, `BARCHART_PERCENT`, `BARCHART_STACKED_PERCENT`, `GAUGE_PERCENT`, `PIECHART_PERCENT`, `DONUTCHART_PERCENT`

### 특수 태그

| 태그 | 용도 | 예시 |
|---|---|---|
| `SECTION` | 섹션 구분 제목 | `SELECT '매출 분석' as SECTION` |
| `LABEL` | 다음 쿼리의 차트 제목 | `SELECT '일별 매출 추이' as LABEL` |
| `COMPARE` | KPI 비교 값 (1행 2열의 두 번째 컬럼) | `SELECT 100 as value, 80 as COMPARE` |
| `XLINE` / `YLINE` | 수직/수평 참조선 | `SELECT 50 as YLINE, '목표' as LABEL` |
| `TREND` | 테이블 내 트렌드 표시 | 컬럼 alias에 TREND 포함 |
| `COLOR` | 시리즈 색상 지정 | `SELECT name, val as LINECHART, '#ff0000' as COLOR` |
| `DOWNLOAD_CSV` | CSV 다운로드 버튼 | `SELECT 'report' as DOWNLOAD_CSV` |
| `DOWNLOAD_XLSX` | XLSX 다운로드 버튼 | `SELECT 'report' as DOWNLOAD_XLSX` |
| `DOWNLOAD_PDF` | PDF 다운로드 버튼 | `SELECT 'report' as DOWNLOAD_PDF` |
| `RELOAD` | 자동 새로고침 (초 단위) | `SELECT 30 as RELOAD` |
| `HEADER_IMAGE` | 대시보드 헤더 이미지 URL | `SELECT 'https://...' as HEADER_IMAGE` |
| `FOOTER_LINK` | 푸터 링크 URL | `SELECT 'https://...' as FOOTER_LINK` |

### 차트 자동 감지 우선순위

```
LINECHART + XAXIS                       → linechart
BARCHART + XAXIS                        → barchartHorizontal
BARCHART + YAXIS                        → barchartVertical
BARCHART_STACKED + XAXIS + CATEGORY     → barchartHorizontalStacked
BARCHART_STACKED + YAXIS + CATEGORY     → barchartVerticalStacked
DROPDOWN                                → dropdown
DROPDOWN_MULTI                          → dropdownMulti
DATEPICKER                              → datepicker
DATEPICKER_FROM + DATEPICKER_TO         → daterangePicker
DOWNLOAD_*                              → download button
GAUGE                                   → gauge
PIECHART / DONUTCHART                   → piechart / donutchart
INPUT                                   → input
1행 1열 (태그 없음)                       → value (KPI)
1행 2열 + COMPARE                       → value with comparison
그 외                                   → table
```

### 전체 지원 태그 목록

```
LABEL, XAXIS, YAXIS, XLINE, YLINE,
LINECHART, LINECHART_PERCENT, LINECHART_CATEGORY, LINECHART_COLOR,
BARCHART, BARCHART_PERCENT, BARCHART_STACKED, BARCHART_STACKED_PERCENT,
BARCHART_PERCENT_STACKED, BARCHART_CATEGORY, BARCHART_COLOR,
CATEGORY, COLOR, COMPARE, TREND, PERCENT,
PIECHART, PIECHART_PERCENT, PIECHART_CATEGORY, PIECHART_COLOR,
DONUTCHART, DONUTCHART_PERCENT, DONUTCHART_CATEGORY,
GAUGE, GAUGE_PERCENT, RANGE, LABELS, COLORS,
DROPDOWN, DROPDOWN_MULTI, HINT, INPUT,
DATEPICKER, DATEPICKER_FROM, DATEPICKER_TO,
SECTION, PLACEHOLDER,
DOWNLOAD_CSV, DOWNLOAD_XLSX, DOWNLOAD_PDF,
RELOAD, SCHEDULE, SCHEDULE_ALL,
HEADER_IMAGE, FOOTER_LINK, ID
```

---

## 6. Variables (대시보드 파라미터)

URL 쿼리 파라미터로 변수를 전달하고, SQL에서 `$변수명`으로 사용합니다.

```bash
# 단일 값
GET /api/dashboards/:id?region=US

# 다중 값 (배열)
GET /api/dashboards/:id?category=Tech&category=Finance
```

```sql
-- SQL에서 변수 사용
SELECT * FROM sales
WHERE region = $region
AND category IN (SELECT UNNEST($category))
```

- 다중 값 파라미터는 `VARCHAR[]` 배열로 변환됨
- 드롭다운/날짜선택기 등 UI 컨트롤에서 선택한 값도 자동으로 변수로 전달됨

---

## 7. Downloads

```bash
# CSV 다운로드 (queryIndex는 1부터 시작)
curl "http://localhost:5454/api/dashboards/:id/query/1/report.csv" \
  -H "Authorization: Bearer shaperkey.xxx.yyy" -o report.csv

# XLSX 다운로드
curl "http://localhost:5454/api/dashboards/:id/query/1/report.xlsx" \
  -H "Authorization: Bearer shaperkey.xxx.yyy" -o report.xlsx

# PDF 다운로드
curl "http://localhost:5454/api/dashboards/:id/pdf/report.pdf" \
  -H "Authorization: Bearer shaperkey.xxx.yyy" -o report.pdf
```

---

## 8. 기타 Endpoints

| Endpoint | Method | Auth | 설명 |
|---|---|---|---|
| `/api/apps` | GET | API Key / JWT | 전체 대시보드/태스크 목록 (sort, filter, pagination) |
| `/api/public/:id/status` | GET | 불필요 | 공개 대시보드 visibility 확인 |
| `/api/system/config` | GET | 불필요 | 시스템 설정 조회 |
| `/health` | GET/HEAD | 불필요 | 헬스체크 → 204 |
| `/metrics` | GET | API Key | Prometheus 메트릭 |
| `/api/data/:table_name` | POST | API Key / JWT | DuckDB에 이벤트 데이터 인제스트 |

### 앱 목록 조회 (`GET /api/apps`)

```bash
GET /api/apps?sort=updated&order=desc&path=/dashboards/&recursive=true&include_content=false&limit=20&offset=0
```

---

## 9. Init SQL & DuckDB Configuration

| Flag | 환경변수 | 설명 |
|---|---|---|
| `--init-sql` | `SHAPER_INIT_SQL` | 시작 시 실행할 SQL 문자열 |
| `--init-sql-file` | `SHAPER_INIT_SQL_FILE` | 시작 시 실행할 SQL 파일 |
| `--duckdb-ext-dir` | `SHAPER_DUCKDB_EXT_DIR` | DuckDB 확장 디렉토리 |
| `--duckdb-secret-dir` | `SHAPER_DUCKDB_SECRET_DIR` | DuckDB Secret 디렉토리 |
| `-d` / `--dir` | `SHAPER_DIR` | 데이터 디렉토리 (기본 `~/.shaper`, Docker `/data`) |

- SQL 내 `$VAR` / `${VAR}` → `os.ExpandEnv`로 환경변수 치환
- SQL 주석 (`--`) 은 실행 전 자동 제거
- 기본 init-sql-file 경로: `{data-dir}/init.sql`
- Docker 기본: `SHAPER_INIT_SQL_FILE=/var/lib/shaper/init.sql` (data-dir과 다름, 오버라이드 필요)

### S3 Delta Lake init.sql 예시

```sql
INSTALL httpfs;
INSTALL delta;
LOAD httpfs;
LOAD delta;

CREATE OR REPLACE SECRET s3_secret (
    TYPE S3,
    KEY_ID '${AWS_ACCESS_KEY_ID}',
    SECRET '${AWS_SECRET_ACCESS_KEY}',
    SESSION_TOKEN '${AWS_SESSION_TOKEN}',
    REGION 'ap-northeast-2',
    SCOPE 's3://my-bucket'
);
```

```bash
# Docker 실행
eval $(aws configure export-credentials --profile my-profile --format env)

docker run --rm -it -p5454:5454 \
    -v /path/to/data:/data \
    -e SHAPER_INIT_SQL_FILE=/data/init.sql \
    -e AWS_ACCESS_KEY_ID \
    -e AWS_SECRET_ACCESS_KEY \
    -e AWS_SESSION_TOKEN \
    taleshape/shaper
```

### Delta Lake 쿼리 문법

```sql
-- 반드시 delta_scan() 함수 사용
SELECT * FROM delta_scan('s3://bucket-name/path/to/delta-table/')

-- 일반 테이블명 직접 접근 불가
-- SELECT * FROM gold.mdi.terms  ← 불가
```

---

## 10. Multi-Query Dashboards

세미콜론(`;`)으로 여러 쿼리를 구분하면 대시보드에 여러 차트가 생성됩니다.

```sql
-- KPI 값
SELECT count(*) as total_users FROM users;

-- 라인 차트
SELECT date as XAXIS, count(*) as LINECHART FROM signups GROUP BY 1;

-- 바 차트
SELECT country as XAXIS, count(*) as BARCHART FROM users GROUP BY 1 ORDER BY 2 DESC LIMIT 10;

-- 테이블
SELECT name, email, created_at FROM users ORDER BY created_at DESC LIMIT 20;
```

이 SQL은 하나의 대시보드에 4개 시각화(KPI, 라인 차트, 바 차트, 테이블)를 생성합니다.
