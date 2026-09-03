import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json());

// ─────────────────────────────────────────
// PSX Data Fetcher — Multiple fallback URLs
// ─────────────────────────────────────────
async function fetchPSX(path) {
  // Try multiple PSX endpoints
  const endpoints = [
    `https://dps.psx.com.pk${path}`,
    `https://www.psx.com.pk/api${path}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
          "Referer": "https://www.psx.com.pk/",
          "Origin": "https://www.psx.com.pk",
          "Cache-Control": "no-cache",
        },
      });
      if (res.ok) {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text };
        }
      }
    } catch (err) {
      console.error(`Failed ${url}:`, err.message);
    }
  }
  return { error: "Could not fetch PSX data — API may be blocked from this region" };
}

// ─────────────────────────────────────────
// Scraper fallback — sarmaaya.pk
// ─────────────────────────────────────────
async function fetchStockFallback(symbol) {
  try {
    const res = await fetch(`https://sarmaaya.pk/api/psx/quote/${symbol.toUpperCase()}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (res.ok) return await res.json();
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    return { error: err.message };
  }
}

// ─────────────────────────────────────────
// Create new MCP server per connection
// ─────────────────────────────────────────
function createServer() {
  const server = new McpServer({
    name: "PSX Pakistan Stock Exchange",
    version: "1.0.0",
  });

  // TOOL 1: Live stock price
  server.tool(
    "get_stock_price",
    { symbol: z.string().describe("PSX symbol e.g. MEBL, ENGRO, LUCK, UBL") },
    async ({ symbol }) => {
      let data = await fetchPSX(`/symbol/${symbol.toUpperCase()}`);
      // Fallback if PSX API fails
      if (data.error) {
        data = await fetchStockFallback(symbol);
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // TOOL 2: KMI-30 halal stocks
  server.tool("get_kmi30", {}, async () => {
    const data = await fetchPSX("/indices/KMI30");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // TOOL 3: Market summary
  server.tool("get_market_summary", {}, async () => {
    const data = await fetchPSX("/market-watch");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // TOOL 4: Historical data
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
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // TOOL 5: Top movers
  server.tool("get_top_movers", {}, async () => {
    const data = await fetchPSX("/market-watch/top-movers");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // TOOL 6: Search stock
  server.tool(
    "search_stock",
    { query: z.string().describe("Company name e.g. Meezan, Engro, Lucky") },
    async ({ query }) => {
      const data = await fetchPSX(`/symbol?q=${encodeURIComponent(query)}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}

// ─────────────────────────────────────────
// SSE — New server per connection
// ─────────────────────────────────────────
const transports = {};

app.get("/sse", async (req, res) => {
  try {
    const server = createServer();
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;
    res.on("close", () => delete transports[transport.sessionId]);
    await server.connect(transport);
  } catch (err) {
    console.error("SSE error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.post("/messages", async (req, res) => {
  try {
    const transport = transports[req.query.sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).json({ error: "Session not found" });
    }
  } catch (err) {
    console.error("Message error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health checks
app.get("/", (req, res) => res.status(200).json({ status: "PSX MCP Server running ✅" }));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// Prevent crashes
process.on("uncaughtException", (err) => console.error("Uncaught:", err.message));
process.on("unhandledRejection", (err) => console.error("Rejection:", err));

const PORT = parseInt(process.env.PORT || "3000");
app.listen(PORT, "0.0.0.0", () => console.log(`PSX MCP Server running on port ${PORT}`));
