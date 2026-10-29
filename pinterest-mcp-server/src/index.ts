#!/usr/bin/env node
/**
 * MCP server for the Pinterest API v5 (stdio).
 * Requires PINTEREST_ACCESS_TOKEN.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { apiRequest, CHARACTER_LIMIT } from "./api.js";

enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json"
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const DESTROY = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

const formatField = z
  .enum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("'markdown' for readable text, 'json' for structured data");
const pageSize = z.number().int().min(1).max(100).default(25).describe("Maximum items to return (1-100)");
const bookmark = z.string().optional().describe("Pagination bookmark from a previous result's next_bookmark");

// Pinterest objects are passed through loosely: fields vary by account and product access.
type Obj = Record<string, unknown>;
interface Page {
  items: Obj[];
  bookmark?: string | null;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** Renders a page of items, halving it until the text fits CHARACTER_LIMIT. */
function renderPage(
  title: string,
  data: Page,
  format: ResponseFormat,
  line: (item: Obj) => string
) {
  let items = data.items ?? [];
  const render = (subset: Obj[]) => {
    const truncated = subset.length < (data.items ?? []).length;
    const page = {
      count: subset.length,
      items: subset,
      has_more: truncated || Boolean(data.bookmark),
      // A bookmark only resumes after the full page, so it is withheld if we trimmed items
      ...(!truncated && data.bookmark ? { next_bookmark: data.bookmark } : {})
    };
    if (format === ResponseFormat.JSON) return { page, out: JSON.stringify(page, null, 2) };
    const lines = [`# ${title}`, `Showing ${subset.length}.`, "", ...subset.map(line)];
    if (truncated) lines.push("", "Output trimmed to fit size limit; request a smaller page_size.");
    else if (data.bookmark) lines.push("", `More results: call again with bookmark="${data.bookmark}".`);
    return { page, out: lines.join("\n") };
  };
  let r = render(items);
  while (items.length > 1 && r.out.length > CHARACTER_LIMIT) {
    items = items.slice(0, Math.ceil(items.length / 2));
    r = render(items);
  }
  if (format === ResponseFormat.JSON) {
    return { content: [{ type: "text" as const, text: r.out }], structuredContent: r.page };
  }
  return text(items.length === 0 ? `# ${title}\nNo results.` : r.out);
}

const boardLine = (b: Obj) =>
  `- **${b.name}** (${b.id}) — ${b.privacy ?? "?"}, ${(b.pin_count as number | undefined) ?? "?"} pins` +
  (b.description ? `\n  ${b.description}` : "");

const pinLine = (p: Obj) =>
  `- **${p.title || "(untitled)"}** (${p.id}) — board ${p.board_id ?? "?"}` +
  (p.link ? `\n  Link: ${p.link}` : "") +
  (p.description ? `\n  ${p.description}` : "");

function createServer(): McpServer {
  const server = new McpServer({ name: "pinterest-mcp-server", version: "1.0.0" });

  server.registerTool(
    "pinterest_get_account",
    {
      title: "Get Pinterest Account",
      description:
        "Get the authenticated Pinterest user's profile: username, account type, follower/pin/board counts. Use to confirm the connection works.",
      inputSchema: z.strictObject({}),
      annotations: READ
    },
    async (_args, ctx) => {
      const u = await apiRequest<Obj>("GET", "user_account", { signal: ctx.mcpReq.signal });
      return text(JSON.stringify(u, null, 2));
    }
  );

  server.registerTool(
    "pinterest_list_boards",
    {
      title: "List Boards",
      description:
        "List the user's boards (id, name, privacy, pin count). Use the ids with pinterest_list_board_pins or pinterest_create_pin.",
      inputSchema: z.strictObject({
        page_size: pageSize,
        bookmark,
        privacy: z.enum(["PUBLIC", "PROTECTED", "SECRET"]).optional().describe("Only boards with this privacy"),
        response_format: formatField
      }),
      annotations: READ
    },
    async ({ page_size, bookmark, privacy, response_format }, ctx) => {
      const data = await apiRequest<Page>("GET", "boards", {
        params: { page_size, bookmark, privacy },
        signal: ctx.mcpReq.signal
      });
      return renderPage("Boards", data, response_format, boardLine);
    }
  );

  server.registerTool(
    "pinterest_get_board",
    {
      title: "Get Board",
      description: "Get details for one board by id.",
      inputSchema: z.strictObject({ board_id: z.string().min(1).describe("Board id from pinterest_list_boards") }),
      annotations: READ
    },
    async ({ board_id }, ctx) => {
      const b = await apiRequest<Obj>("GET", `boards/${encodeURIComponent(board_id)}`, { signal: ctx.mcpReq.signal });
      return text(JSON.stringify(b, null, 2));
    }
  );

  server.registerTool(
    "pinterest_create_board",
    {
      title: "Create Board",
      description: 'Create a board. Example: "Make a secret board called Kitchen Ideas" -> name="Kitchen Ideas", privacy="SECRET".',
      inputSchema: z.strictObject({
        name: z.string().min(1).max(180).describe("Board name"),
        description: z.string().max(500).optional().describe("Board description"),
        privacy: z.enum(["PUBLIC", "SECRET"]).default("PUBLIC").describe("Board visibility")
      }),
      annotations: WRITE
    },
    async (args, ctx) => {
      const b = await apiRequest<Obj>("POST", "boards", { body: args, signal: ctx.mcpReq.signal });
      return text(`Created board:\n${boardLine(b)}`);
    }
  );

  server.registerTool(
    "pinterest_update_board",
    {
      title: "Update Board",
      description: "Rename a board or change its description or privacy. Only provided fields change.",
      inputSchema: z.strictObject({
        board_id: z.string().min(1),
        name: z.string().min(1).max(180).optional(),
        description: z.string().max(500).optional(),
        privacy: z.enum(["PUBLIC", "SECRET"]).optional()
      }),
      annotations: { ...WRITE, idempotentHint: true }
    },
    async ({ board_id, ...fields }, ctx) => {
      const b = await apiRequest<Obj>("PATCH", `boards/${encodeURIComponent(board_id)}`, {
        body: fields,
        signal: ctx.mcpReq.signal
      });
      return text(`Updated board:\n${boardLine(b)}`);
    }
  );

  server.registerTool(
    "pinterest_delete_board",
    {
      title: "Delete Board",
      description: "PERMANENTLY delete a board and all its pins. Confirm with the user before calling.",
      inputSchema: z.strictObject({ board_id: z.string().min(1) }),
      annotations: DESTROY
    },
    async ({ board_id }, ctx) => {
      await apiRequest("DELETE", `boards/${encodeURIComponent(board_id)}`, { signal: ctx.mcpReq.signal });
      return text(`Deleted board ${board_id}.`);
    }
  );

  server.registerTool(
    "pinterest_list_board_pins",
    {
      title: "List Pins on a Board",
      description: "List pins saved to one board. Use pinterest_list_pins for all of the user's pins.",
      inputSchema: z.strictObject({
        board_id: z.string().min(1),
        page_size: pageSize,
        bookmark,
        response_format: formatField
      }),
      annotations: READ
    },
    async ({ board_id, page_size, bookmark, response_format }, ctx) => {
      const data = await apiRequest<Page>("GET", `boards/${encodeURIComponent(board_id)}/pins`, {
        params: { page_size, bookmark },
        signal: ctx.mcpReq.signal
      });
      return renderPage(`Pins on board ${board_id}`, data, response_format, pinLine);
    }
  );

  server.registerTool(
    "pinterest_list_pins",
    {
      title: "List My Pins",
      description: "List pins owned by the authenticated user across all boards.",
      inputSchema: z.strictObject({ page_size: pageSize, bookmark, response_format: formatField }),
      annotations: READ
    },
    async ({ page_size, bookmark, response_format }, ctx) => {
      const data = await apiRequest<Page>("GET", "pins", {
        params: { page_size, bookmark },
        signal: ctx.mcpReq.signal
      });
      return renderPage("My pins", data, response_format, pinLine);
    }
  );

  server.registerTool(
    "pinterest_get_pin",
    {
      title: "Get Pin",
      description: "Get full details for one pin by id.",
      inputSchema: z.strictObject({ pin_id: z.string().min(1).describe("Pin id from a list tool") }),
      annotations: READ
    },
    async ({ pin_id }, ctx) => {
      const p = await apiRequest<Obj>("GET", `pins/${encodeURIComponent(pin_id)}`, { signal: ctx.mcpReq.signal });
      return text(JSON.stringify(p, null, 2));
    }
  );

  server.registerTool(
    "pinterest_search_pins",
    {
      title: "Search My Pins",
      description:
        "Search the user's own pins by keyword. (Pinterest's public search is not available to most apps; this searches the user's pins only.)",
      inputSchema: z.strictObject({
        query: z.string().min(1).describe("Keywords to match"),
        page_size: pageSize,
        bookmark,
        response_format: formatField
      }),
      annotations: READ
    },
    async ({ query, page_size, bookmark, response_format }, ctx) => {
      const data = await apiRequest<Page>("GET", "search/partner/pins", {
        params: { query, page_size, bookmark },
        signal: ctx.mcpReq.signal
      }).catch(async (error: unknown) => {
        // Fall back to filtering the user's own pins client-side.
        void error;
        const own = await apiRequest<Page>("GET", "pins", {
          params: { page_size: 100 },
          signal: ctx.mcpReq.signal
        });
        const q = query.toLowerCase();
        return {
          items: (own.items ?? []).filter(p =>
            [p.title, p.description, p.alt_text].some(v => String(v ?? "").toLowerCase().includes(q))
          )
        } as Page;
      });
      return renderPage(`Pins matching '${query}'`, data, response_format, pinLine);
    }
  );

  server.registerTool(
    "pinterest_create_pin",
    {
      title: "Create Pin",
      description:
        'Create a pin on a board from a public image URL. Example: "Pin this photo to my Recipes board" -> board_id (from pinterest_list_boards), image_url. Publishes content to Pinterest, so confirm details with the user first.',
      inputSchema: z.strictObject({
        board_id: z.string().min(1).describe("Target board id"),
        image_url: z.url().describe("Publicly reachable https image URL"),
        title: z.string().max(100).optional().describe("Pin title"),
        description: z.string().max(800).optional().describe("Pin description"),
        link: z.url().optional().describe("Destination URL when the pin is clicked"),
        alt_text: z.string().max(500).optional().describe("Accessibility text")
      }),
      annotations: WRITE
    },
    async ({ image_url, ...rest }, ctx) => {
      const p = await apiRequest<Obj>("POST", "pins", {
        body: { ...rest, media_source: { source_type: "image_url", url: image_url } },
        signal: ctx.mcpReq.signal
      });
      return text(`Created pin:\n${pinLine(p)}`);
    }
  );

  server.registerTool(
    "pinterest_delete_pin",
    {
      title: "Delete Pin",
      description: "PERMANENTLY delete a pin the user owns. Confirm with the user before calling.",
      inputSchema: z.strictObject({ pin_id: z.string().min(1) }),
      annotations: DESTROY
    },
    async ({ pin_id }, ctx) => {
      await apiRequest("DELETE", `pins/${encodeURIComponent(pin_id)}`, { signal: ctx.mcpReq.signal });
      return text(`Deleted pin ${pin_id}.`);
    }
  );

  return server;
}

serveStdio(createServer);
console.error("pinterest-mcp-server running on stdio");
