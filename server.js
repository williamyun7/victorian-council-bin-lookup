#!/usr/bin/env node

const CASEY_SEARCH_URL = "https://www.casey.vic.gov.au/coc-properties/api/search-address";
const HUME_SEARCH_URL = "https://www.hume.vic.gov.au/api/v1/myarea/searchfuzzy";
const HUME_WASTE_SERVICES_URL = "https://www.hume.vic.gov.au/ocapi/Public/myarea/wasteservices";
const HUME_PAGE_LINK = "/$b9015858-988c-48a4-9473-7c193df083e4$/Residents/Waste/Know-my-bin-day";
const PROPERTY_TYPES = [
  100, 110, 111, 112, 113, 114, 116, 117, 118, 120, 121, 123, 124, 125, 128,
  130, 131, 132, 133, 140, 141, 142, 143, 144, 212, 232, 233, 235, 752
].join(",");

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (const message of readMessages()) {
    handleMessage(message).catch((error) => {
      if (message && message.id !== undefined) {
        sendError(message.id, -32603, error.message);
      }
    });
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

async function handleMessage(message) {
  if (!message || typeof message.method !== "string") return;

  if (message.method === "notifications/initialized") return;

  if (message.id === undefined) return;

  switch (message.method) {
    case "initialize":
      sendResult(message.id, {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "Victorian Council Bin Lookup",
          version: "1.0.0"
        },
        instructions:
          "Use get_bin_collection to check Victorian council bin collection dates for an address. Currently supports City of Casey and Hume City Council. Prefer the exact address result when multiple matches are returned."
      });
      break;

    case "tools/list":
      sendResult(message.id, {
        tools: [
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
        ]
      });
      break;

    case "tools/call":
      await callTool(message);
      break;

    default:
      sendError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

async function callTool(message) {
  const { name, arguments: args = {} } = message.params || {};

  if (name !== "get_bin_collection") {
    sendError(message.id, -32601, `Unknown tool: ${name}`);
    return;
  }

  if (!args.address || typeof args.address !== "string") {
    sendError(message.id, -32602, "address is required");
    return;
  }

  const result = await getBinCollection(args.address, args.date, args.council);
  sendResult(message.id, {
    content: [
      {
        type: "text",
        text: formatResult(result)
      }
    ],
    structuredContent: result
  });
}

async function getBinCollection(address, date, council = "auto") {
  const normalizedCouncil = normalizeCouncil(council);
  if (normalizedCouncil === "casey") return getCaseyBinCollection(address, date);
  if (normalizedCouncil === "hume") return getHumeBinCollection(address, date);

  const caseyResult = await getCaseyBinCollection(address, date);
  if (caseyResult.found) return caseyResult;

  const humeResult = await getHumeBinCollection(address, date);
  if (humeResult.found) return humeResult;

  return {
    address,
    requestedAddress: address,
    council: "auto",
    found: false,
    source: [CASEY_SEARCH_URL, HUME_SEARCH_URL],
    message: "No matching property was found in the supported council lookups.",
    attempts: [caseyResult.message, humeResult.message].filter(Boolean)
  };
}

async function getCaseyBinCollection(address, date, lookupAddress = formatCaseyLookupAddress(address)) {
  const params = new URLSearchParams({
    term: lookupAddress,
    status: "C,F",
    land_area: "0",
    types: PROPERTY_TYPES,
    inclusion: "true",
    prop_type_details: "",
    separate_address: "0",
    bin_collection_details: "true"
  });

  const response = await fetch(`${CASEY_SEARCH_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "victorian-council-bin-lookup/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Casey lookup failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  const matches = Array.isArray(data.result) ? data.result.filter(Boolean) : [];
  if (matches.length === 0) {
    return {
      address,
      requestedAddress: address,
      lookupAddress,
      council: "casey",
      found: false,
      source: CASEY_SEARCH_URL,
      message: "No matching City of Casey property was found."
    };
  }

  const property = chooseBestMatch(matches, lookupAddress);
  const referenceDate = parseReferenceDate(date || melbourneToday());
  const week = weekWindow(referenceDate);
  const collections = [
    collection("Rubbish bin", property.NextGarbageDate, "weekly"),
    collection("Recycling bin", property.NextRecycleDate, "fortnightly"),
    collection("Food & garden bin", property.NextGardenDate, "fortnightly")
  ].filter((item) => item.date);

  const nextDate = collections
    .map((item) => item.date)
    .sort()[0];

  return {
    address: property.full_address,
    requestedAddress: address,
    lookupAddress,
    council: "casey",
    councilName: "City of Casey",
    found: true,
    propertyId: property.property_id || property.Id,
    collectionDay: property.bin_collection_day || null,
    week: {
      starts: formatIsoDate(week.start),
      ends: formatIsoDate(week.end)
    },
    nextCollectionDate: nextDate || null,
    binsOnNextCollection: collections
      .filter((item) => item.date === nextDate)
      .map((item) => item.bin),
    collections,
    otherMatches: matches
      .filter((item) => item !== property)
      .slice(0, 5)
      .map((item) => item.full_address),
    source: CASEY_SEARCH_URL
  };
}

async function getHumeBinCollection(address, date, lookupAddress = formatHumeLookupAddress(address)) {
  const searchParams = new URLSearchParams({
    keywords: lookupAddress,
    maxresults: "5"
  });

  const searchResponse = await fetch(`${HUME_SEARCH_URL}?${searchParams.toString()}`, {
    headers: requestHeaders("https://www.hume.vic.gov.au/Residents/Waste/Know-my-bin-day")
  });

  if (!searchResponse.ok) {
    throw new Error(`Hume address lookup failed with HTTP ${searchResponse.status}`);
  }

  const searchData = await searchResponse.json();
  const matches = Array.isArray(searchData.Items) ? searchData.Items.filter(Boolean) : [];
  if (matches.length === 0) {
    return {
      address,
      requestedAddress: address,
      lookupAddress,
      council: "hume",
      found: false,
      source: HUME_SEARCH_URL,
      message: "No matching Hume City Council property was found."
    };
  }

  const property = chooseBestHumeMatch(matches, lookupAddress);
  const serviceParams = new URLSearchParams({
    geolocationid: property.Id,
    ocsvclang: "en-AU",
    pageLink: HUME_PAGE_LINK
  });

  const serviceResponse = await fetch(`${HUME_WASTE_SERVICES_URL}?${serviceParams.toString()}`, {
    headers: requestHeaders("https://www.hume.vic.gov.au/Residents/Waste/Know-my-bin-day")
  });

  if (!serviceResponse.ok) {
    throw new Error(`Hume waste services lookup failed with HTTP ${serviceResponse.status}`);
  }

  const serviceData = await serviceResponse.json();
  const collections = parseHumeCollections(serviceData.responseContent || "");
  if (collections.length === 0) {
    return {
      address: property.AddressSingleLine,
      requestedAddress: address,
      lookupAddress,
      council: "hume",
      councilName: "Hume City Council",
      found: false,
      source: HUME_WASTE_SERVICES_URL,
      message: "Hume City Council returned the address but no bin collection dates."
    };
  }

  const referenceDate = parseReferenceDate(date || melbourneToday());
  const week = weekWindow(referenceDate);
  const nextDate = collections
    .map((item) => item.date)
    .filter(Boolean)
    .sort()[0];

  return {
    address: property.AddressSingleLine,
    requestedAddress: address,
    lookupAddress,
    council: "hume",
    councilName: "Hume City Council",
    found: true,
    propertyId: property.Id,
    collectionDay: nextDate ? weekdayName(nextDate) : null,
    week: {
      starts: formatIsoDate(week.start),
      ends: formatIsoDate(week.end)
    },
    nextCollectionDate: nextDate || null,
    binsOnNextCollection: collections
      .filter((item) => item.date === nextDate)
      .map((item) => item.bin),
    collections,
    otherMatches: matches
      .filter((item) => item !== property)
      .slice(0, 5)
      .map((item) => item.AddressSingleLine),
    source: HUME_WASTE_SERVICES_URL
  };
}

function chooseBestMatch(matches, address) {
  const normalizedAddress = normalize(address);
  return (
    matches.find((item) => normalize(item.full_address).includes(normalizedAddress)) ||
    matches[0]
  );
}

function chooseBestHumeMatch(matches, address) {
  const normalizedAddress = normalize(address);
  return (
    matches.find((item) => normalize(item.AddressSingleLine).includes(normalizedAddress)) ||
    matches[0]
  );
}

function parseHumeCollections(html) {
  const collections = [];
  const articlePattern = /<article>([\s\S]*?)<\/article>/gi;
  let match;

  while ((match = articlePattern.exec(html)) !== null) {
    const article = match[1];
    const title = textContent((article.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
    const dateText = textContent((article.match(/<div class="next-service">\s*([\s\S]*?)\s*<\/div>/i) || [])[1]);
    const date = parseHumeDate(dateText);
    if (!title || !date) continue;

    collections.push({
      bin: humeBinName(title),
      date,
      cadence: /garbage/i.test(title) ? "weekly" : "fortnightly"
    });
  }

  return collections;
}

function humeBinName(title) {
  if (/garbage/i.test(title)) return "Garbage bin";
  if (/recycling/i.test(title)) return "Recycling bin";
  if (/food|garden|green/i.test(title)) return "Food & garden bin";
  return `${title} bin`;
}

function parseHumeDate(value) {
  const match = String(value).match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\b/i);
  if (!match) return null;

  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

function textContent(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function collection(bin, date, cadence) {
  return {
    bin,
    date: date || null,
    cadence
  };
}

function formatResult(result) {
  if (!result.found) return `${result.message}\nSource: ${Array.isArray(result.source) ? result.source.join(", ") : result.source}`;

  const nextBins = result.binsOnNextCollection.join(", ") || "No bins listed";
  const lines = [
    `Council: ${result.councilName || result.council || "Unknown"}`,
    `Address: ${result.address}`,
    `Collection day: ${result.collectionDay || "Unknown"}`,
    `Week checked: ${result.week.starts} to ${result.week.ends}`,
    `Next collection: ${result.nextCollectionDate || "Unknown"}`,
    `Bins on next collection: ${nextBins}`,
    "",
    "Upcoming dates:"
  ];

  for (const item of result.collections) {
    lines.push(`- ${item.bin}: ${item.date} (${item.cadence})`);
  }

  lines.push("", `Source: ${result.source}`);
  return lines.join("\n");
}

function normalizeCouncil(value) {
  const normalized = normalize(value || "auto");
  if (normalized.includes("casey")) return "casey";
  if (normalized.includes("hume")) return "hume";
  return "auto";
}

function cleanAddressSpacing(value) {
  return String(value)
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCaseyLookupAddress(value) {
  let address = cleanAddressSpacing(value).replace(/\s*,\s*/g, " ");
  const postcodeMatch = address.match(/\b(\d{4})\b\s*$/);

  if (postcodeMatch && !/\bVIC\b/i.test(address)) {
    address = address.replace(/\s+\d{4}\s*$/, ` VIC ${postcodeMatch[1]}`);
  }

  return address.toUpperCase();
}

function formatHumeLookupAddress(value) {
  return cleanAddressSpacing(value)
    .replace(/\bVIC\b/gi, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function melbourneToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseReferenceDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("date must be in YYYY-MM-DD format");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function weekWindow(date) {
  const start = new Date(date);
  const day = start.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return { start, end };
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function weekdayName(isoDate) {
  const date = parseReferenceDate(isoDate);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "long"
  }).format(date);
}

function requestHeaders(referer) {
  return {
    Accept: "application/json, text/javascript, */*; q=0.01",
    Referer: referer,
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "victorian-council-bin-lookup/1.0"
  };
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
