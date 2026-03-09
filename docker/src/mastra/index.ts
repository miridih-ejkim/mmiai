import { Mastra } from "@mastra/core/mastra";
import { textProcessorAgent } from "./agents/text-processor";

export const mastra = new Mastra({
  agents: {
    textProcessorAgent,
  },
  server: {
    port: 4112,
  },
});
