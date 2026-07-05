# Victorian Council Bin Lookup

Victorian Council Bin Lookup is a local MCP server for checking council bin collection dates from a residential address.

It exposes a `get_bin_collection` MCP tool that returns upcoming rubbish, recycling, and food/garden collection dates in a structured format.

The server is designed to grow council-by-council, using small adapters for each council's public lookup system.

## Supported Councils

- City of Casey
- Hume City Council

## Features

- Look up bin collection dates by address
- Supports City of Casey and Hume City Council
- Returns structured MCP output for AI agents
- Handles council-specific address formatting
- No OpenAI API key required
- Runs locally over MCP stdio

## Install

Clone this repository and install dependencies:

```bash
git clone https://github.com/williamyun7/victorian-council-bin-lookup.git
cd victorian-council-bin-lookup
npm install
```

This project currently has no external npm dependencies, but `npm install` will still prepare the local package if dependencies are added later.

## Test Directly

```bash
npm run test:call
```

You can pass an address and council:

```bash
npm run test:call -- --council casey 123 Demo Street Exampleville 3999
npm run test:call -- --council hume 45 Sample Road Testfield 3998
```

## Add to Codex

```bash
codex mcp add victorian-council-bin-lookup -- node /path/to/victorian-council-bin-lookup/server.js
```

Then start a new Codex thread and ask:

```text
Use the Victorian Council Bin Lookup MCP tool to check which bins are collected for 123 Demo Street Exampleville this week.
```

The server exposes one MCP tool: `get_bin_collection`.

## Tool Input

`get_bin_collection` accepts:

- `address` required residential address
- `council` optional value: `auto`, `casey`, or `hume`
- `date` optional date in `YYYY-MM-DD` format, defaulting to today in Melbourne time

Address input is formatted for each council before lookup.

- Casey searches uppercase addresses and keeps/adds `VIC` before a postcode, for example `123 DEMO STREET EXAMPLEVILLE VIC 3999`.
- Hume removes `VIC` and tidies comma spacing, for example `45 Sample Road, Testfield 3998`.

## Example Prompts

```text
Use the Victorian Council Bin Lookup MCP tool to check which bins are collected for 123 Demo Street Exampleville VIC 3999 this week.
```

```text
Use the Victorian Council Bin Lookup MCP tool to check the bin collection for 45 Sample Road, Testfield 3998 next week.
```

## Responsible Use

This project uses public council lookup endpoints and is intended for light personal use. Please avoid bulk scraping or frequent polling, and respect each council website's terms and availability.
