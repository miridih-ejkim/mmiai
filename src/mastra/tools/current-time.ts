import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const currentTimeTool = createTool({
  id: "get-current-datetime",
  description:
    "현재 날짜와 시간을 반환합니다. 검색 시 날짜 기준이 필요하거나, 사용자가 '오늘', '지금' 등의 시간 표현을 사용할 때 호출하세요.",
  outputSchema: z.object({
    datetime: z.string(),
    date: z.string(),
    time: z.string(),
    timezone: z.string(),
  }),
  execute: async () => {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return {
      datetime: kst.toISOString().replace("Z", "+09:00"),
      date: kst.toISOString().slice(0, 10),
      time: kst.toISOString().slice(11, 19),
      timezone: "Asia/Seoul (KST, UTC+9)",
    };
  },
});
