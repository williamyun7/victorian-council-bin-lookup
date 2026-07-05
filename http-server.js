#!/usr/bin/env node

import http from "node:http";
import { URL } from "node:url";
import { handleMcpRequest } from "./src/mcp.js";
import { getBinCollection } from "./src/lookup.js";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const apiKey = process.env.API_KEY || "";
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS || "");

const server = http.createServer(async (request, response) => {
  try {
    if (!isAllowedOrigin(request)) {
      sendJson(response, 403, { error: "Origin is not allowed." });
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "victorian-council-bin-lookup"
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/bin-collection") {
      if (!isAuthorized(request)) {
        sendJson(response, 401, { error: "Unauthorized." });
        return;
      }

      const address = url.searchParams.get("address");
      if (!address) {
        sendJson(response, 400, { error: "address query parameter is required." });
        return;
      }

      const result = await getBinCollection(
        address,
        url.searchParams.get("date") || undefined,
        url.searchParams.get("council") || "auto"
      );
      sendJson(response, 200, result);
      return;
    }

    if (url.pathname === "/mcp") {
      await handleMcpHttp(request, response);
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (caught) {
    sendJson(response, 500, { error: caught.message || "Internal server error." });
  }
});

server.listen(port, host, () => {
  console.error(`Victorian Council Bin Lookup HTTP server listening on ${host}:${port}`);
});

async function handleMcpHttp(request, response) {
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "Unauthorized." });
    return;
  }

  if (request.method === "GET") {
    response.writeHead(405, {
      Allow: "POST",
      "Content-Type": "application/json"
    });
    response.end(JSON.stringify({ error: "This MCP server accepts JSON-RPC over POST." }));
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, {
      Allow: "POST",
      "Content-Type": "application/json"
    });
    response.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  const body = await readBody(request);
  const message = JSON.parse(body || "{}");
  const rpcResponse = await handleMcpRequest(message);

  if (!rpcResponse) {
    response.writeHead(202);
    response.end();
    return;
  }

  sendJson(response, 200, rpcResponse, {
    "MCP-Protocol-Version": message.params?.protocolVersion || "2025-06-18"
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy(new Error("Request body too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request) {
  if (!apiKey) return true;
  return request.headers.authorization === `Bearer ${apiKey}` || request.headers["x-api-key"] === apiKey;
}

function parseAllowedOrigins(value) {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(request) {
  if (allowedOrigins.length === 0) return true;
  const origin = request.headers.origin;
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}
