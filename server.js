import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json());

// Helper: PSX data fetch
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

// Tool definitions — shared config
function registerTools(server) {
  server.tool(
    "get_stock_price",
    { symbol: z.string().describe("Stock symbol e.g. MEBL, ENGRO, LUCK") },
    async ({ symbol }) => {
      const data = await fetchPSX(`/symbol/${symbol.toUpperCase()}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_kmi30", {}, async () => {
    const data = await fetchPSX(`/indices/KMI30`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("get_market_summary", {}, async () => {
    const data = await fetchPSX(`/market-watch`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool(
    "get_history",
    {
      symbol: z.string().describe("Stock symbol e.g. MEBL"),
      from: z.string().describe("Start date YYYY-MM-DD"),
      to: z.string().describe("End date YYYY-MM-DD"),
    },
    async ({ symbol, from, to }) => {
      const data = await fetchPSX(`/timeseries/eod?symbol=${symbol.toUpperCase()}&from=${from}&to=${to}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_top_movers", {}, async () => {
    const data = await fetchPSX(`/market-watch/top-movers`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool(
    "search_stock",
    { query: z.string().describe("Company name e.g. Meezan, Engro") },
    async ({ query }) => {
      const data = await fetchPSX(`/symbol?q=${encodeURIComponent(query)}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}

// SSE — NEW server instance per connection (fixes the error!)
const transports = {};

app.get("/sse", async (req, res) => {
  const server = new McpServer({
    name: "PSX Pakistan Stock Exchange",
    version: "1.0.0",
  });
  registerTools(server);

  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const transport = transports[req.query.sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "Session not found" });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "PSX MCP Server running ✅" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PSX MCP Server running on port ${PORT}`);
});
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_psx_stock") {
    const symbol = request.params.arguments?.symbol;
    return {
      content: [{ type: "text", text: `PSX Stock Data for ${symbol}: Server Active` }]
    };
  }
  throw new Error("Tool not found");
});

app.get("/", (req, res) => {
  res.json({ status: "PSX MCP Server running ✅" });
});

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No active SSE session");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
