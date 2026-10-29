/** Self-check: starts the built server, lists tools, and checks error paths. Run: npm run build && npm run smoke */
import { strict as assert } from "node:assert";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...getDefaultEnvironment(), PINTEREST_ACCESS_TOKEN: process.env.PINTEREST_ACCESS_TOKEN ?? "" }
  })
);

const { tools } = await client.listTools();
assert.equal(tools.length, 12, "expected 12 tools");
assert.ok(tools.every(t => t.name.startsWith("pinterest_")));

const invalid = await client.callTool({ name: "pinterest_create_pin", arguments: { board_id: "1" } });
assert.equal(invalid.isError, true, "missing image_url should be rejected");

if (process.env.PINTEREST_ACCESS_TOKEN) {
  const me = await client.callTool({ name: "pinterest_get_account", arguments: {} });
  assert.ok(!me.isError, `get_account failed: ${JSON.stringify(me.content)}`);
  const boards = await client.callTool({ name: "pinterest_list_boards", arguments: { response_format: "json" } });
  assert.ok(!boards.isError, `list_boards failed: ${JSON.stringify(boards.content)}`);
} else {
  const noToken = await client.callTool({ name: "pinterest_get_account", arguments: {} });
  assert.equal(noToken.isError, true);
  console.error("No PINTEREST_ACCESS_TOKEN: skipped live calls");
}

await client.close();
console.error("Smoke test passed");
