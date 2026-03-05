import { Mastra } from "@mastra/core/mastra";
import { dataAnalystAgent } from "./agents/data-analyst";
import { textProcessorAgent } from "./agents/text-processor";

export const mastra = new Mastra({
  agents: {
    dataAnalystAgent,
    textProcessorAgent,
  },
  server: {
    port: 4112,
  },
});
