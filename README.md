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
- Runs locally over MCP stdio or remotely over HTTP

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

## Run as an HTTP Server

For Azure or other hosted environments, run the HTTP entrypoint:

```bash
npm start
```

By default this listens on port `3000`. You can change it with `PORT`:

```bash
PORT=8080 npm run http
```

HTTP endpoints:

- `GET /health` health check for hosting platforms
- `POST /mcp` JSON-RPC MCP endpoint
- `GET /api/bin-collection?address=...&council=auto` simple REST endpoint for testing

Optional environment variables:

- `API_KEY` protects `/mcp` and `/api/bin-collection` with `Authorization: Bearer <key>` or `x-api-key: <key>`
- `ALLOWED_ORIGINS` comma-separated list of allowed browser origins
- `PORT` HTTP listen port
- `HOST` HTTP bind host, defaults to `0.0.0.0` for container hosting

Example REST test:

```bash
curl "http://localhost:3000/api/bin-collection?address=123%20Demo%20Street%20Exampleville%203999&council=casey"
```

Example MCP initialize call:

```bash
curl -X POST "http://localhost:3000/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

## Deploy to Azure App Service

Azure App Service is the recommended Azure deployment path for this project. It avoids Azure Container Registry build tasks and runs the HTTP MCP endpoint with `npm start`.

```bash
az login
az group create \
  --name victorian-council-bin-lookup-rg \
  --location australiaeast \
  --output table

az appservice plan create \
  --name victorian-council-bin-lookup-plan \
  --resource-group victorian-council-bin-lookup-rg \
  --location australiaeast \
  --sku F1 \
  --is-linux \
  --output table

az webapp create \
  --name victorian-council-bin-lookup \
  --resource-group victorian-council-bin-lookup-rg \
  --plan victorian-council-bin-lookup-plan \
  --runtime "NODE:22-lts" \
  --startup-file "npm start" \
  --output table
```

Deploy from the repository folder:

```bash
zip -r app.zip . -x ".git/*" "node_modules/*" "app.zip"

az webapp deploy \
  --name victorian-council-bin-lookup \
  --resource-group victorian-council-bin-lookup-rg \
  --src-path app.zip \
  --type zip
```

Test the deployed app:

```bash
curl https://victorian-council-bin-lookup.azurewebsites.net/health
```

Expected response:

```json
{"ok":true,"service":"victorian-council-bin-lookup"}
```

Test the MCP endpoint:

```bash
curl -X POST "https://victorian-council-bin-lookup.azurewebsites.net/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

To require an API key:

```bash
az webapp config appsettings set \
  --name victorian-council-bin-lookup \
  --resource-group victorian-council-bin-lookup-rg \
  --settings API_KEY="replace-with-a-long-random-value"
```

Then include the key when calling `/mcp` or `/api/bin-collection`:

```bash
curl -X POST "https://victorian-council-bin-lookup.azurewebsites.net/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer replace-with-a-long-random-value" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The App Service deployment runs `npm start`, which starts `http-server.js`.

## Deploy to Azure Container Apps

The included `Dockerfile` can also run this server on Azure Container Apps, but `az containerapp up --source .` uses Azure Container Registry Tasks to build the image. Some subscriptions do not allow ACR Tasks and will fail with `TasksOperationsNotAllowed`.

If your subscription supports ACR Tasks, deploy from the repository folder:

```bash
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
az provider register --namespace Microsoft.ContainerRegistry

az containerapp up \
  --name victorian-council-bin-lookup \
  --resource-group victorian-council-bin-lookup-rg \
  --location australiaeast \
  --environment victorian-council-bin-lookup-env \
  --source .
```

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
