import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();

globalThis.onmessage = handler.onmessage.bind(handler);
