import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as mime from "mime-types";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const server = new Server(
  {
    name: "cowork-mcp-plugin",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "upload_file",
        description:
          "Upload a file to the shared workspace. Supports text and binary files.",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "The name to save the file as",
            },
            content: {
              type: "string",
              description:
                "File content (text content or base64-encoded for binary files)",
            },
            encoding: {
              type: "string",
              enum: ["text", "base64"],
              description: "Content encoding: 'text' for plain text, 'base64' for binary files",
              default: "text",
            },
          },
          required: ["filename", "content"],
        },
      },
      {
        name: "download_file",
        description: "Download/read a file from the shared workspace.",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "The name of the file to read",
            },
          },
          required: ["filename"],
        },
      },
      {
        name: "list_files",
        description: "List all files in the shared workspace.",
        inputSchema: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              description: "Subdirectory to list (optional, defaults to root)",
            },
          },
        },
      },
      {
        name: "delete_file",
        description: "Delete a file from the shared workspace.",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "The name of the file to delete",
            },
          },
          required: ["filename"],
        },
      },
      {
        name: "get_file_info",
        description: "Get metadata about a file in the shared workspace.",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "The name of the file to inspect",
            },
          },
          required: ["filename"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "upload_file": {
      const { filename, content, encoding = "text" } = args as {
        filename: string;
        content: string;
        encoding?: string;
      };

      const safeName = path.basename(filename);
      const filePath = path.join(UPLOADS_DIR, safeName);

      if (!filePath.startsWith(UPLOADS_DIR + path.sep) && filePath !== UPLOADS_DIR) {
        return {
          content: [{ type: "text", text: "Error: Invalid file path" }],
          isError: true,
        };
      }

      try {
        if (encoding === "base64") {
          const buffer = Buffer.from(content, "base64");
          fs.writeFileSync(filePath, buffer);
        } else {
          fs.writeFileSync(filePath, content, "utf-8");
        }

        const stats = fs.statSync(filePath);
        const mimeType = mime.lookup(safeName) || "application/octet-stream";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `File '${safeName}' uploaded successfully`,
                file: {
                  name: safeName,
                  size: stats.size,
                  mimeType,
                  uploadedAt: stats.mtime.toISOString(),
                },
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error uploading file: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "download_file": {
      const { filename } = args as { filename: string };
      const safeName = path.basename(filename);
      const filePath = path.join(UPLOADS_DIR, safeName);

      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: "text", text: `Error: File '${safeName}' not found` }],
          isError: true,
        };
      }

      try {
        const mimeType = mime.lookup(safeName) || "application/octet-stream";
        const isText =
          mimeType.startsWith("text/") ||
          mimeType.includes("json") ||
          mimeType.includes("xml") ||
          mimeType.includes("javascript") ||
          mimeType.includes("typescript");

        if (isText) {
          const content = fs.readFileSync(filePath, "utf-8");
          return {
            content: [{ type: "text", text: content }],
          };
        } else {
          const buffer = fs.readFileSync(filePath);
          const base64 = buffer.toString("base64");
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  filename: safeName,
                  mimeType,
                  encoding: "base64",
                  content: base64,
                }),
              },
            ],
          };
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading file: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "list_files": {
      const { directory = "" } = args as { directory?: string };
      const targetDir = directory
        ? path.join(UPLOADS_DIR, path.normalize(directory))
        : UPLOADS_DIR;

      if (!targetDir.startsWith(UPLOADS_DIR)) {
        return {
          content: [{ type: "text", text: "Error: Invalid directory path" }],
          isError: true,
        };
      }

      if (!fs.existsSync(targetDir)) {
        return {
          content: [{ type: "text", text: "Error: Directory not found" }],
          isError: true,
        };
      }

      try {
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        const files = entries.map((entry) => {
          const entryPath = path.join(targetDir, entry.name);
          const stats = fs.statSync(entryPath);
          return {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            size: entry.isFile() ? stats.size : null,
            mimeType: entry.isFile()
              ? mime.lookup(entry.name) || "application/octet-stream"
              : null,
            modifiedAt: stats.mtime.toISOString(),
          };
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ files, total: files.length }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing files: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "delete_file": {
      const { filename } = args as { filename: string };
      const safeName = path.basename(filename);
      const filePath = path.join(UPLOADS_DIR, safeName);

      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: "text", text: `Error: File '${safeName}' not found` }],
          isError: true,
        };
      }

      try {
        fs.unlinkSync(filePath);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `File '${safeName}' deleted successfully`,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting file: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "get_file_info": {
      const { filename } = args as { filename: string };
      const safeName = path.basename(filename);
      const filePath = path.join(UPLOADS_DIR, safeName);

      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: "text", text: `Error: File '${safeName}' not found` }],
          isError: true,
        };
      }

      try {
        const stats = fs.statSync(filePath);
        const mimeType = mime.lookup(safeName) || "application/octet-stream";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  name: safeName,
                  size: stats.size,
                  mimeType,
                  createdAt: stats.birthtime.toISOString(),
                  modifiedAt: stats.mtime.toISOString(),
                  isReadOnly: false,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting file info: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Cowork MCP Plugin running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
