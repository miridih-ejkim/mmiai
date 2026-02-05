import { initializeMastra } from "./init";

// top-level await (ESM)
const { mastra, shutdown } = await initializeMastra();

export { mastra };
