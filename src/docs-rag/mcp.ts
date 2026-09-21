import { DOC_SCOPES } from "@/docs-rag/scopes";
import { askDocs, parseSearchBody, searchDocs } from "@/docs-rag/query";
import type { DocsRagBindings } from "@/docs-rag/types";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

const TOOLS = [
  {
    name: "search_trackdub_docs",
    description:
      "Hybrid search over Trackdub, Trackdub-gated, api.trackdub, and pinned vendor docs (NVIDIA TRT-RTX, WinML, AMD, Intel, Qualcomm, Qwen, Whisper, ONNX Runtime). Prefer this for implementation facts. Scope filters the R2 folder.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        scope: { type: "string", enum: [...DOC_SCOPES] },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
    },
  },
  {
    name: "ask_trackdub_docs",
    description:
      "Answer from the same corpus using Workers AI. First-party Trackdub docs outrank vendor pages. Does not claim readiness the retrieved text does not state.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        scope: { type: "string", enum: [...DOC_SCOPES] },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
    },
  },
];

function rpcResult(id: JsonRpcRequest["id"], result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export async function handleMcp(request: Request, env: DocsRagBindings): Promise<Response> {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "parse error");
  }

  const method = body.method ?? "";
  switch (method) {
    case "initialize":
      return rpcResult(body.id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "trackdub-docs-rag", version: "0.1.0" },
      });
    case "notifications/initialized":
    case "ping":
      return rpcResult(body.id, {});
    case "tools/list":
      return rpcResult(body.id, { tools: TOOLS });
    case "tools/call":
      return callTool(body, env);
    default:
      return rpcError(body.id, -32601, `unknown method: ${method}`);
  }
}

async function callTool(body: JsonRpcRequest, env: DocsRagBindings): Promise<Response> {
  const params = body.params;
  if (!params || typeof params !== "object") return rpcError(body.id, -32602, "missing params");
  const record = params as Record<string, unknown>;
  const name = record.name;
  const args = record.arguments ?? {};
  if (name !== "search_trackdub_docs" && name !== "ask_trackdub_docs") {
    return rpcError(body.id, -32602, "unknown tool");
  }
  const parsed = parseSearchBody(args);
  if ("error" in parsed) return rpcError(body.id, -32602, parsed.error);
  try {
    const payload = name === "search_trackdub_docs" ? await searchDocs(env, parsed) : await askDocs(env, parsed);
    return rpcResult(body.id, {
      content: [{ type: "text", text: JSON.stringify(payload) }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "search failed";
    return rpcResult(body.id, {
      isError: true,
      content: [{ type: "text", text: message }],
    });
  }
}
