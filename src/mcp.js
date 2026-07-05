import { getBinCollection } from "./lookup.js";

export const serverInfo = {
  name: "Victorian Council Bin Lookup",
  version: "1.0.0"
};

export const instructions =
  "Use get_bin_collection to check Victorian council bin collection dates for an address. Currently supports City of Casey and Hume City Council. Prefer the exact address result when multiple matches are returned.";

export const tools = [
  {
    name: "get_bin_collection",
    description:
      "Look up rubbish, recycling, and food/garden bin collection dates for supported Victorian council property addresses.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Property address, for example '123 Demo Street Exampleville'."
        },
        council: {
          type: "string",
          description:
            "Optional council adapter. Use 'casey', 'hume', or 'auto'. Defaults to 'auto'.",
          enum: ["auto", "casey", "hume"]
        },
        date: {
          type: "string",
          description:
            "Optional ISO date used for the week calculation. Defaults to today in Australia/Melbourne.",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$"
        }
      },
      required: ["address"],
      additionalProperties: false
    }
  }
];

export async function handleMcpRequest(message) {
  if (!message || typeof message.method !== "string") return null;
  if (message.method === "notifications/initialized") return null;
  if (message.id === undefined) return null;

  try {
    switch (message.method) {
      case "initialize":
        return result(message.id, {
          protocolVersion: message.params?.protocolVersion || "2025-06-18",
          capabilities: {
            tools: {}
          },
          serverInfo,
          instructions
        });

      case "tools/list":
        return result(message.id, { tools });

      case "tools/call":
        return result(message.id, await callTool(message.params));

      default:
        return error(message.id, -32601, `Method not found: ${message.method}`);
    }
  } catch (caught) {
    return error(message.id, caught.code || -32603, caught.message || "Internal error");
  }
}

export async function callTool(params = {}) {
  const { name, arguments: args = {} } = params;

  if (name !== "get_bin_collection") {
    throw new McpError(-32601, `Unknown tool: ${name}`);
  }

  if (!args.address || typeof args.address !== "string") {
    throw new McpError(-32602, "address is required");
  }

  const lookupResult = await getBinCollection(args.address, args.date, args.council);
  return {
    content: [
      {
        type: "text",
        text: formatResult(lookupResult)
      }
    ],
    structuredContent: lookupResult
  };
}

export function formatResult(lookupResult) {
  if (!lookupResult.found) {
    const source = Array.isArray(lookupResult.source)
      ? lookupResult.source.join(", ")
      : lookupResult.source;
    return `${lookupResult.message}\nSource: ${source}`;
  }

  const nextBins = lookupResult.binsOnNextCollection.join(", ") || "No bins listed";
  const lines = [
    `Council: ${lookupResult.councilName || lookupResult.council || "Unknown"}`,
    `Address: ${lookupResult.address}`,
    `Collection day: ${lookupResult.collectionDay || "Unknown"}`,
    `Week checked: ${lookupResult.week.starts} to ${lookupResult.week.ends}`,
    `Next collection: ${lookupResult.nextCollectionDate || "Unknown"}`,
    `Bins on next collection: ${nextBins}`,
    "",
    "Upcoming dates:"
  ];

  for (const item of lookupResult.collections) {
    lines.push(`- ${item.bin}: ${item.date} (${item.cadence})`);
  }

  lines.push("", `Source: ${lookupResult.source}`);
  return lines.join("\n");
}

export function result(id, value) {
  return { jsonrpc: "2.0", id, result: value };
}

export function error(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

class McpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
