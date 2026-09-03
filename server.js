import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const app = express();
const PORT = process.env.PORT || 3000;

// CORS headers (Claude integration ke liye)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const server = new Server(
  { name: "psx-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

let transport;

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_psx_stock",
        description: "Fetch PSX stock data",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Stock symbol e.g. HUBC, FFC" }
          },
          required: ["symbol"]
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
