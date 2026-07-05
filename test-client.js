#!/usr/bin/env node

import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["server.js"], {
  cwd: new URL(".", import.meta.url),
  stdio: ["pipe", "pipe", "inherit"]
});

let nextId = 1;
const pending = new Map();
let buffer = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const raw = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  }
});

function request(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve) => pending.set(id, resolve));
}

await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "casey-bins-test-client", version: "1.0.0" }
});

child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const tools = await request("tools/list", {});
console.log(JSON.stringify(tools.result, null, 2));

const argv = process.argv.slice(2);
const councilIndex = argv.indexOf("--council");
const council = councilIndex === -1 ? undefined : argv.splice(councilIndex, 2)[1];

const args = {
  address: argv.join(" ") || "123 Demo Street Exampleville",
  date: "2026-07-05"
};

if (council) args.council = council;

const result = await request("tools/call", {
  name: "get_bin_collection",
  arguments: args
});

if (result.error) {
  console.error(JSON.stringify(result.error, null, 2));
  child.kill();
  process.exit(1);
}

console.log(result.result.content[0].text);
child.kill();
