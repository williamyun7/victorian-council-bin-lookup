#!/usr/bin/env node

import { handleMcpRequest } from "./src/mcp.js";

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (const message of readMessages()) {
    handleMessage(message);
  }
});

process.stdin.resume();

function readMessages() {
  const messages = [];

  while (buffer.length > 0) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) break;

      const raw = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);
      messages.push(JSON.parse(raw));
      continue;
    }

    const newline = buffer.indexOf("\n");
    if (newline === -1) break;

    const raw = buffer.slice(0, newline).toString("utf8").trim();
    buffer = buffer.slice(newline + 1);
    if (raw) messages.push(JSON.parse(raw));
  }

  return messages;
}

function handleMessage(message) {
  handleMcpRequest(message)
    .then((response) => {
      if (response) send(response);
    })
    .catch((caught) => {
      if (message && message.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: caught.message || "Internal error" }
        });
      }
    });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
