import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json());

// ✅ PSX MCP Server
const server = new McpServer({
  name: "PSX Pakistan Stock Exchange",
  version: "1.0.0",
});

// Helper: PSX data fetch karna
async function fetchPSX(path) {
  try {
    const res = await fetch(`https://dps.psx.com.pk${path}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "https://www.psx.com.pk/",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

// ─────────────────────────────────────────
// TOOL 1: Live stock quote
// ─────────────────────────────────────────
server.tool(
  "get_stock_price",
  {
    symbol: z.string().describe("Stock symbol e.g. MEBL, ENGRO, LUCK, UBL"),
  },
  async ({ symbol }) => {
    const data = await fetchPSX(`/symbol/${symbol.toUpperCase()}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─────────────────────────────────────────
// TOOL 2: KMI-30 Index (Halal stocks list)
// ─────────────────────────────────────────
server.tool(
  "get_kmi30",
  {},
  async () => {
    const data = await fetchPSX(`/indices/KMI30`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─────────────────────────────────────────
// TOOL 3: Market summary (KSE-100 etc)
// ─────────────────────────────────────────
server.tool(
  "get_market_summary",
  {},
  async () => {
    const data = await fetchPSX(`/market-watch`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─────────────────────────────────────────
// TOOL 4: Historical price data
// ─────────────────────────────────────────
server.tool(
  "get_history",
  {
    symbol: z.string().describe("Stock symbol e.g. MEBL"),
    from: z.string().describe("Start date YYYY-MM-DD"),
    to: z.string().describe("End date YYYY-MM-DD"),
  },
  async ({ symbol, from, to }) => {
    const data = await fetchPSX(
      `/timeseries/eod?symbol=${symbol.toUpperCase()}&from=${from}&to=${to}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─────────────────────────────────────────
// TOOL 5: Top gainers & losers
// ─────────────────────────────────────────
server.tool(
  "get_top_movers",
  {},
  async () => {
    const data = await fetchPSX(`/market-watch/top-movers`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─────────────────────────────────────────
// TOOL 6: Search stock by name
// ─────────────────────────────────────────
server.tool(
  "search_stock",
  {
    query: z.string().describe("Company name e.g. Meezan, Engro, Lucky"),
  },
  async ({ query }) => {
    const data = await fetchPSX(`/symbol?q=${encodeURIComponent(query)}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─────────────────────────────────────────
// SSE Transport Setup (Claude ke liye)
// ─────────────────────────────────────────
const transports = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => {
    delete transports[transport.sessionId];
  });
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "Session not found" });
  }
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "PSX MCP Server running ✅" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`PSX MCP Server running on port ${PORT}`);
});
