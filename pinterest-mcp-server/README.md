# pinterest-mcp-server

MCP server (stdio) for the [Pinterest API v5](https://developers.pinterest.com/docs/api/v5/).

## Tools

| Tool | Type |
|---|---|
| `pinterest_get_account` | read |
| `pinterest_list_boards`, `pinterest_get_board` | read |
| `pinterest_list_board_pins`, `pinterest_list_pins`, `pinterest_get_pin`, `pinterest_search_pins` | read |
| `pinterest_create_board`, `pinterest_update_board`, `pinterest_create_pin` | write |
| `pinterest_delete_board`, `pinterest_delete_pin` | destructive |

## Get an access token

1. Create an app at <https://developers.pinterest.com/apps/> (new apps start with *Trial* access: read works, but pins/boards you create are not public until Standard access is approved).
2. For quick testing, open the app and use **Generate access token** with scopes `user_accounts:read, boards:read, boards:write, pins:read, pins:write`.
3. Tokens from that page are short-lived. For long-term use, run the OAuth 2.0 authorization-code flow and refresh the token.

## Build and run

```bash
npm install && npm run build
PINTEREST_ACCESS_TOKEN=... npm run smoke   # optional self-check
```

## Add to Claude

Claude Code:

```bash
claude mcp add pinterest -e PINTEREST_ACCESS_TOKEN=your_token -- node /absolute/path/to/pinterest-mcp-server/dist/index.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "pinterest": {
      "command": "node",
      "args": ["/absolute/path/to/pinterest-mcp-server/dist/index.js"],
      "env": { "PINTEREST_ACCESS_TOKEN": "your_token" }
    }
  }
}
```

The token is read from the environment only and is never logged.
