import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const SHAPER_BASE_URL =
  process.env.SHAPER_BASE_URL || "http://localhost:5454";
const SHAPER_API_KEY = process.env.SHAPER_API_KEY || "";

/** 대시보드 결과에서 쿼리 데이터를 CSV 문자열로 변환 */
function toCsvPreview(
  columns: Array<{ name: string; type: string }>,
  rows: unknown[][],
  maxRows: number,
): { csv: string; totalRows: number } {
  const header = columns.map((c) => c.name).join(",");
  const limited = rows.slice(0, maxRows);
  const body = limited.map((row) =>
    row
      .map((cell) => {
        if (cell == null) return "";
        const str = String(cell);
        // CSV 이스케이프: 쉼표, 따옴표, 줄바꿈 포함 시 따옴표로 감싸기
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(","),
  );
  return {
    csv: [header, ...body].join("\n"),
    totalRows: rows.length,
  };
}

/**
 * Shaper 대시보드 생성 Tool (Deploy API)
 *
 * 1. POST /api/deploy → 대시보드 생성
 * 2. GET /api/dashboards/:id → 쿼리 실행 결과 조회
 * 3. 대시보드 URL + 데이터 CSV 프리뷰 반환
 */
export const shaperTool = createTool({
  id: "create-shaper-dashboard",
  description: `Shaper Deploy API를 통해 DuckDB SQL 대시보드를 생성하고 쿼리 실행 결과를 반환합니다.
SQL 쿼리를 API로 전송하면 시각화 대시보드 URL과 함께 실제 쿼리 결과 데이터(CSV)를 받습니다.
데이터 분석 및 시각화가 필요할 때 사용하세요.

**주의**
- 조회 가능한 S3 경로는 's3://miridih-de-databricks-catalog' 버킷 내 경로로 제한됩니다.
- 모든 데이터 경로는 's3://miridih-de-databricks-catalog' 하위의 bronze, silver, gold 디렉토리 내 경로로 제한됩니다.
- 모든 S3 내 데이터는 delta lake 포맷이므로, delta_scan() 함수를 사용해 S3 경로를 전달해야 합니다.

입력:
- dashboardName: URL-safe 대시보드 이름 (영문, 숫자, 하이픈, 언더스코어)
- sqlQuery: DuckDB SQL 쿼리
- description: (선택) 대시보드 설명

출력:
- dashboardUrl: 대시보드 접근 URL
- dashboardId: 생성된 대시보드 ID
- csvPreview: 쿼리 결과 CSV (최대 50행). 이 데이터를 분석하여 인사이트를 제공하세요.
- totalRows: 전체 결과 행 수
- columns: 컬럼 이름과 타입 목록
- success: 성공 여부`,
  inputSchema: z.object({
    dashboardName: z
      .string()
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        "Dashboard name must be URL-safe (alphanumeric, hyphens, underscores)",
      )
      .describe("URL-safe 대시보드 이름 (예: 'sales_report', 'user_metrics')"),
    sqlQuery: z
      .string()
      .min(10, "SQL query must be at least 10 characters")
      .describe("DuckDB SQL 쿼리"),
    description: z
      .string()
      .optional()
      .describe("대시보드 설명 (SQL 상단 주석으로 추가됨)"),
  }),
  outputSchema: z.object({
    dashboardUrl: z.string().describe("대시보드 접근 URL"),
    dashboardId: z.string().describe("생성된 대시보드 ID"),
    success: z.boolean().describe("성공 여부"),
    error: z.string().optional().describe("실패 시 에러 메시지"),
    csvPreview: z
      .string()
      .optional()
      .describe("쿼리 결과 CSV 프리뷰 (헤더 + 최대 50행)"),
    totalRows: z
      .number()
      .optional()
      .describe("전체 결과 행 수"),
    columns: z
      .array(
        z.object({
          name: z.string(),
          type: z.string(),
        }),
      )
      .optional()
      .describe("결과 컬럼 정보"),
  }),
  execute: async ({ dashboardName, sqlQuery, description }) => {
    if (!SHAPER_API_KEY) {
      return {
        dashboardUrl: "",
        dashboardId: "",
        success: false,
        error: "SHAPER_API_KEY 환경변수가 설정되지 않았습니다.",
      };
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SHAPER_API_KEY}`,
    };

    try {
      const sqlContent = description
        ? `-- ${description}\n\n${sqlQuery}`
        : sqlQuery;

      // Step 1: Deploy API로 대시보드 생성
      const res = await fetch(`${SHAPER_BASE_URL}/api/deploy`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          apps: [
            {
              type: "dashboard",
              operation: "create",
              data: {
                name: dashboardName,
                path: `/dashboards/${dashboardName}`,
                content: sqlContent,
              },
            },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          dashboardUrl: "",
          dashboardId: "",
          success: false,
          error: `Deploy API 실패 (${res.status}): ${errText}`,
        };
      }

      const body = (await res.json()) as {
        results: Array<{
          operation: string;
          type: string;
          id: string;
          status: string;
        }>;
      };

      const result = body.results?.[0];
      if (!result || result.status !== "created") {
        return {
          dashboardUrl: "",
          dashboardId: "",
          success: false,
          error: `대시보드 생성 실패: ${JSON.stringify(body)}`,
        };
      }

      const dashboardId = result.id;
      const dashboardUrl = `${SHAPER_BASE_URL}/dashboards/${dashboardId}`;

      // Step 2: 대시보드 쿼리 결과 조회
      try {
        const dashRes = await fetch(
          `${SHAPER_BASE_URL}/api/dashboards/${dashboardId}`,
          { headers },
        );

        if (!dashRes.ok) {
          return {
            dashboardUrl,
            dashboardId,
            success: true,
            error: `대시보드 생성 성공. 결과 조회 실패 (${dashRes.status}): ${await dashRes.text()}`,
          };
        }

        const dashData = (await dashRes.json()) as {
          sections?: Array<{
            queries?: Array<{
              columns?: Array<{ name: string; type: string }>;
              rows?: unknown[][];
            }>;
          }>;
        };

        // 모든 섹션의 쿼리 결과를 병합
        const allColumns: Array<{ name: string; type: string }> = [];
        const allRows: unknown[][] = [];

        for (const section of dashData.sections ?? []) {
          for (const query of section.queries ?? []) {
            if (query.columns && query.rows) {
              if (allColumns.length === 0) {
                allColumns.push(...query.columns);
              }
              allRows.push(...query.rows);
            }
          }
        }

        if (allColumns.length === 0) {
          return {
            dashboardUrl,
            dashboardId,
            success: true,
            error: "대시보드 생성 성공. 쿼리 결과가 비어있습니다.",
          };
        }

        const { csv, totalRows } = toCsvPreview(allColumns, allRows, 50);

        return {
          dashboardUrl,
          dashboardId,
          success: true,
          csvPreview: csv,
          totalRows,
          columns: allColumns.map((c) => ({ name: c.name, type: c.type })),
        };
      } catch (fetchErr) {
        // 결과 조회 실패해도 대시보드 생성은 성공
        const msg =
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        return {
          dashboardUrl,
          dashboardId,
          success: true,
          error: `대시보드 생성 성공. 결과 조회 중 오류: ${msg}`,
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        dashboardUrl: "",
        dashboardId: "",
        success: false,
        error: `Shaper API 요청 실패: ${msg}`,
      };
    }
  },
});
