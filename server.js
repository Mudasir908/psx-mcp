import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json());

// ─────────────────────────────────────────
// Yahoo Finance — PSX stocks use .KA suffix
// ─────────────────────────────────────────
async function fetchYahoo(symbol) {
  try {
    const ticker = `${symbol.toUpperCase()}.KA`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("No data found");
    return {
      symbol: symbol.toUpperCase(),
      name: meta.longName || meta.shortName || symbol,
      price: meta.regularMarketPrice,
      previousClose: meta.previousClose,
      change: (meta.regularMarketPrice - meta.previousClose).toFixed(2),
      changePercent: (((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100).toFixed(2) + "%",
      dayHigh: meta.regularMarketDayHigh,
      dayLow: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
      marketCap: meta.marketCap,
      currency: meta.currency,
      exchange: meta.exchangeName,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    };
  } catch (err) {
    return { error: err.message, symbol: symbol.toUpperCase() };
  }
}

// ─────────────────────────────────────────
// Yahoo Finance — Historical data
// ─────────────────────────────────────────
async function fetchHistory(symbol, from, to) {
  try {
    const ticker = `${symbol.toUpperCase()}.KA`;
    const fromTs = Math.floor(new Date(from).getTime() / 1000);
    const toTs = Math.floor(new Date(to).getTime() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${fromTs}&period2=${toTs}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error("No historical data");
    const timestamps = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close;
    const history = timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split("T")[0],
      close: closes?.[i]?.toFixed(2),
    }));
    return { symbol: symbol.toUpperCase(), history };
  } catch (err) {
    return { error: err.message };
  }
}

// ─────────────────────────────────────────
// KMI-30 stocks list (static — always works)
// ─────────────────────────────────────────
const KMI30_STOCKS = [
  "MEBL","ENGRO","LUCK","PSO","OGDC","PPL","HBL","UBL","MCB","BAFL",
  "FFBL","FFC","HUBC","KAPCO","KEL","MLCF","MTL","NCPL","PKGS","PSMC",
  "SEARL","SHEL","SYS","TRG","UNITY","YOUW","FABL","SILK","ACPL","CHCC"
];

// ─────────────────────────────────────────
// Create MCP Server
// ─────────────────────────────────────────
function createServer() {
  const server = new McpServer({
    name: "PSX Pakistan Stock Exchange",
    version: "1.0.0",
  });

  // TOOL 1: Live stock price
  server.tool(
    "get_stock_price",
    { symbol: z.string().describe("PSX symbol e.g. MEBL, ENGRO, LUCK, UBL, OGDC") },
    async ({ symbol }) => {
      const data = await fetchYahoo(symbol);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // TOOL 2: KMI-30 list
  server.tool("get_kmi30", {}, async () => {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ kmi30_stocks: KMI30_STOCKS, total: KMI30_STOCKS.length }, null, 2)
      }]
    };
  });

  // TOOL 3: Multiple stocks at once
  server.tool(
    "get_multiple_stocks",
    { symbols: z.string().describe("Comma separated symbols e.g. MEBL,ENGRO,LUCK") },
    async ({ symbols }) => {
      const list = symbols.split(",").map(s => s.trim()).slice(0, 5);
      const results = await Promise.all(list.map(fetchYahoo));
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  // TOOL 4: Historical data
  server.tool(
    "get_history",
    {
      symbol: z.string().describe("Stock symbol e.g. MEBL"),
      from: z.string().describe("Start date YYYY-MM-DD"),
      to: z.string().describe("End date YYYY-MM-DD"),
    },
    async ({ symbol, from, to }) => {
      const data = await fetchHistory(symbol, from, to);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // TOOL 5: Top KMI-30 stocks snapshot
  server.tool(
    "get_top_kmi30",
    {},
    async () => {
      const top5 = ["MEBL", "ENGRO", "LUCK", "OGDC", "HBL"];
      const results = await Promise.all(top5.map(fetchYahoo));
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  return server;
}

// ─────────────────────────────────────────
// SSE Transport
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
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.status(200).json({ status: "PSX MCP Server running ✅" }));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

process.on("uncaughtException", (err) => console.error("Uncaught:", err.message));
process.on("unhandledRejection", (err) => console.error("Rejection:", err));

const PORT = parseInt(process.env.PORT || "3000");
app.listen(PORT, "0.0.0.0", () => console.log(`PSX MCP Server running on port ${PORT}`));
