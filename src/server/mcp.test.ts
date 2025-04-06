import { McpServer, ToolCallback } from "./mcp.js";
import { Client } from "../client/index.js";
import { InMemoryTransport } from "../inMemory.js";
import { z, ZodRawShape } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ListToolsResultSchema,
  CallToolResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
  CompleteResultSchema,
  LoggingMessageNotificationSchema,
  CallToolRequestSchema,
  CallToolRequest,
  ListToolsRequestSchema,
  ListToolsResult,
  Tool,
  ServerRequest,
  ServerNotification,
} from "../types.js";
import { ResourceTemplate } from "./mcp.js";
import { completable } from "./completable.js";
import { UriTemplate } from "../shared/uriTemplate.js";
import { RequestHandlerExtra } from "../shared/protocol.js";

describe("McpServer", () => {
  test("should expose underlying Server instance", () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    expect(mcpServer.server).toBeDefined();
  });

  test("should allow sending notifications via Server", async () => {
    const mcpServer = new McpServer(
      {
        name: "test server",
        version: "1.0",
      },
      { capabilities: { logging: {} } },
    );

    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    // This should work because we're using the underlying server
    await expect(
      mcpServer.server.sendLoggingMessage({
        level: "info",
        data: "Test log message",
      }),
    ).resolves.not.toThrow();
  });
});

describe("ResourceTemplate", () => {
  test("should create ResourceTemplate with string pattern", () => {
    const template = new ResourceTemplate("test://{category}/{id}", {
      list: undefined,
    });
    expect(template.uriTemplate.toString()).toBe("test://{category}/{id}");
    expect(template.listCallback).toBeUndefined();
  });

  test("should create ResourceTemplate with UriTemplate", () => {
    const uriTemplate = new UriTemplate("test://{category}/{id}");
    const template = new ResourceTemplate(uriTemplate, { list: undefined });
    expect(template.uriTemplate).toBe(uriTemplate);
    expect(template.listCallback).toBeUndefined();
  });

  test("should create ResourceTemplate with list callback", async () => {
    const list = jest.fn().mockResolvedValue({
      resources: [{ name: "Test", uri: "test://example" }],
    });

    const template = new ResourceTemplate("test://{id}", { list });
    expect(template.listCallback).toBe(list);

    const abortController = new AbortController();
    const result = await template.listCallback?.({
      signal: abortController.signal,
      sendRequest: () => { throw new Error("Not implemented") },
      sendNotification: () => { throw new Error("Not implemented") }
    });
    expect(result?.resources).toHaveLength(1);
    expect(list).toHaveBeenCalled();
  });
});

describe("tool()", () => {
  test("should register zero-argument tool", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.tool("test", async () => ({
      content: [
        {
          type: "text",
          text: "Test response",
        },
      ],
    }));

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "tools/list",
      },
      ListToolsResultSchema,
    );

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("test");
    expect(result.tools[0].inputSchema).toEqual({
      type: "object",
    });
  });

  test("should register tool with args schema", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.tool(
      "test",
      {
        name: z.string(),
        value: z.number(),
      },
      async ({ name, value }) => ({
        content: [
          {
            type: "text",
            text: `${name}: ${value}`,
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "tools/list",
      },
      ListToolsResultSchema,
    );

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("test");
    expect(result.tools[0].inputSchema).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string" },
        value: { type: "number" },
      },
    });
  });

  test("should register tool with description", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.tool("test", "Test description", async () => ({
      content: [
        {
          type: "text",
          text: "Test response",
        },
      ],
    }));

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "tools/list",
      },
      ListToolsResultSchema,
    );

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("test");
    expect(result.tools[0].description).toBe("Test description");
  });

  test("should validate tool args", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    mcpServer.tool(
      "test",
      {
        name: z.string(),
        value: z.number(),
      },
      async ({ name, value }) => ({
        content: [
          {
            type: "text",
            text: `${name}: ${value}`,
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    await expect(
      client.request(
        {
          method: "tools/call",
          params: {
            name: "test",
            arguments: {
              name: "test",
              value: "not a number",
            },
          },
        },
        CallToolResultSchema,
      ),
    ).rejects.toThrow(/Invalid arguments/);
  });

  test("should prevent duplicate tool registration", () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    mcpServer.tool("test", async () => ({
      content: [
        {
          type: "text",
          text: "Test response",
        },
      ],
    }));

    expect(() => {
      mcpServer.tool("test", async () => ({
        content: [
          {
            type: "text",
            text: "Test response 2",
          },
        ],
      }));
    }).toThrow(/already registered/);
  });

  test("should allow registering multiple tools", () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    // This should succeed
    mcpServer.tool("tool1", () => ({ content: [] }));

    // This should also succeed and not throw about request handlers
    mcpServer.tool("tool2", () => ({ content: [] }));
  });

  test("should pass sessionId to tool callback via RequestHandlerExtra", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    let receivedSessionId: string | undefined;
    mcpServer.tool("test-tool", async (extra) => {
      receivedSessionId = extra.sessionId;
      return {
        content: [
          {
            type: "text",
            text: "Test response",
          },
        ],
      };
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    // Set a test sessionId on the server transport
    serverTransport.sessionId = "test-session-123";

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    await client.request(
      {
        method: "tools/call",
        params: {
          name: "test-tool",
        },
      },
      CallToolResultSchema,
    );

    expect(receivedSessionId).toBe("test-session-123");
  });

  test("should provide sendNotification withing tool call", async () => {
    const mcpServer = new McpServer(
      {
        name: "test server",
        version: "1.0",
      },
      { capabilities: { logging: {} } },
    );

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    let receivedLogMessage: string | undefined;

    const loggingMessage = "hello here is log message 1"

    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      receivedLogMessage = notification.params.data as string;

    });

    mcpServer.tool("test-tool", async ({ sendNotification }) => {
      await sendNotification({ method: "notifications/message", params: { level: "debug", data: loggingMessage } });
      return {
        content: [
          {
            type: "text",
            text: "Test response",
          },
        ],
      };
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // Set a test sessionId on the server transport
    serverTransport.sessionId = "test-session-123";


    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    await client.request(
      {
        method: "tools/call",
        params: {
          name: "test-tool",
        },
      },
      CallToolResultSchema,
    );
    expect(receivedLogMessage).toBe(loggingMessage);
  });

  test("should allow client to call server tools", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    mcpServer.tool(
      "test",
      "Test tool",
      {
        input: z.string(),
      },
      async ({ input }) => ({
        content: [
          {
            type: "text",
            text: `Processed: ${input}`,
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "test",
          arguments: {
            input: "hello",
          },
        },
      },
      CallToolResultSchema,
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: "Processed: hello",
      },
    ]);
  });

  test("should handle server tool errors gracefully", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    mcpServer.tool("error-test", async () => {
      throw new Error("Tool execution failed");
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "error-test",
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Tool execution failed",
      },
    ]);
  });

  test("should throw McpError for invalid tool name", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    mcpServer.tool("test-tool", async () => ({
      content: [
        {
          type: "text",
          text: "Test response",
        },
      ],
    }));

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    await expect(
      client.request(
        {
          method: "tools/call",
          params: {
            name: "nonexistent-tool",
          },
        },
        CallToolResultSchema,
      ),
    ).rejects.toThrow(/Tool nonexistent-tool not found/);
  });
});

describe("resource()", () => {
  test("should register resource with uri and readCallback", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.resource("test", "test://resource", async () => ({
      contents: [
        {
          uri: "test://resource",
          text: "Test content",
        },
      ],
    }));

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "resources/list",
      },
      ListResourcesResultSchema,
    );

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].name).toBe("test");
    expect(result.resources[0].uri).toBe("test://resource");
  });

  test("should register resource with metadata", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.resource(
      "test",
      "test://resource",
      {
        description: "Test resource",
        mimeType: "text/plain",
      },
      async () => ({
        contents: [
          {
            uri: "test://resource",
            text: "Test content",
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "resources/list",
      },
      ListResourcesResultSchema,
    );

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].description).toBe("Test resource");
    expect(result.resources[0].mimeType).toBe("text/plain");
  });

  test("should register resource template", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.resource(
      "test",
      new ResourceTemplate("test://resource/{id}", { list: undefined }),
      async () => ({
        contents: [
          {
            uri: "test://resource/123",
            text: "Test content",
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "resources/templates/list",
      },
      ListResourceTemplatesResultSchema,
    );

    expect(result.resourceTemplates).toHaveLength(1);
    expect(result.resourceTemplates[0].name).toBe("test");
    expect(result.resourceTemplates[0].uriTemplate).toBe(
      "test://resource/{id}",
    );
  });

  test("should register resource template with listCallback", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.resource(
      "test",
      new ResourceTemplate("test://resource/{id}", {
        list: async () => ({
          resources: [
            {
              name: "Resource 1",
              uri: "test://resource/1",
            },
            {
              name: "Resource 2",
              uri: "test://resource/2",
            },
          ],
        }),
      }),
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            text: "Test content",
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "resources/list",
      },
      ListResourcesResultSchema,
    );

    expect(result.resources).toHaveLength(2);
    expect(result.resources[0].name).toBe("Resource 1");
    expect(result.resources[0].uri).toBe("test://resource/1");
    expect(result.resources[1].name).toBe("Resource 2");
    expect(result.resources[1].uri).toBe("test://resource/2");
  });

  test("should pass template variables to readCallback", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.resource(
      "test",
      new ResourceTemplate("test://resource/{category}/{id}", {
        list: undefined,
      }),
      async (uri, { category, id }) => ({
        contents: [
          {
            uri: uri.href,
            text: `Category: ${category}, ID: ${id}`,
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "resources/read",
        params: {
          uri: "test://resource/books/123",
        },
      },
      ReadResourceResultSchema,
    );

    expect(result.contents[0].text).toBe("Category: books, ID: 123");
  });

  test("should prevent duplicate resource registration", () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    mcpServer.resource("test", "test://resource", async () => ({
      contents: [
        {
          uri: "test://resource",
          text: "Test content",
        },
      ],
    }));

    expect(() => {
      mcpServer.resource("test2", "test://resource", async () => ({
        contents: [
          {
            uri: "test://resource",
            text: "Test content 2",
          },
        ],
      }));
    }).toThrow(/already registered/);
  });

  test("should allow registering multiple resources", () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    // This should succeed
    mcpServer.resource("resource1", "test://resource1", async () => ({
      contents: [
        {
          uri: "test://resource1",
          text: "Test content 1",
        },
      ],
    }));

    // This should also succeed and not throw about request handlers
    mcpServer.resource("resource2", "test://resource2", async () => ({
      contents: [
        {
          uri: "test://resource2",
          text: "Test content 2",
        },
      ],
    }));
  });

  test("should prevent duplicate resource template registration", () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    mcpServer.resource(
      "test",
      new ResourceTemplate("test://resource/{id}", { list: undefined }),
      async () => ({
        contents: [
          {
            uri: "test://resource/123",
            text: "Test content",
          },
        ],
      }),
    );

    expect(() => {
      mcpServer.resource(
        "test",
        new ResourceTemplate("test://resource/{id}", { list: undefined }),
        async () => ({
          contents: [
            {
              uri: "test://resource/123",
              text: "Test content 2",
            },
          ],
        }),
      );
    }).toThrow(/already registered/);
  });

  test("should handle resource read errors gracefully", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.resource("error-test", "test://error", async () => {
      throw new Error("Resource read failed");
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    await expect(
      client.request(
        {
          method: "resources/read",
          params: {
            uri: "test://error",
          },
        },
        ReadResourceResultSchema,
      ),
    ).rejects.toThrow(/Resource read failed/);
  });

  test("should throw McpError for invalid resource URI", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.resource("test", "test://resource", async () => ({
      contents: [
        {
          uri: "test://resource",
          text: "Test content",
        },
      ],
    }));

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    await expect(
      client.request(
        {
          method: "resources/read",
          params: {
            uri: "test://nonexistent",
          },
        },
        ReadResourceResultSchema,
      ),
    ).rejects.toThrow(/Resource test:\/\/nonexistent not found/);
  });

  test("should support completion of resource template parameters", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          resources: {},
        },
      },
    );

    mcpServer.resource(
      "test",
      new ResourceTemplate("test://resource/{category}", {
        list: undefined,
        complete: {
          category: () => ["books", "movies", "music"],
        },
      }),
      async () => ({
        contents: [
          {
            uri: "test://resource/test",
            text: "Test content",
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "completion/complete",
        params: {
          ref: {
            type: "ref/resource",
            uri: "test://resource/{category}",
          },
          argument: {
            name: "category",
            value: "",
          },
        },
      },
      CompleteResultSchema,
    );

    expect(result.completion.values).toEqual(["books", "movies", "music"]);
    expect(result.completion.total).toBe(3);
  });

  test("should support filtered completion of resource template parameters", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          resources: {},
        },
      },
    );

    mcpServer.resource(
      "test",
      new ResourceTemplate("test://resource/{category}", {
        list: undefined,
        complete: {
          category: (test: string) =>
            ["books", "movies", "music"].filter((value) =>
              value.startsWith(test),
            ),
        },
      }),
      async () => ({
        contents: [
          {
            uri: "test://resource/test",
            text: "Test content",
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "completion/complete",
        params: {
          ref: {
            type: "ref/resource",
            uri: "test://resource/{category}",
          },
          argument: {
            name: "category",
            value: "m",
          },
        },
      },
      CompleteResultSchema,
    );

    expect(result.completion.values).toEqual(["movies", "music"]);
    expect(result.completion.total).toBe(2);
  });
});

describe("prompt()", () => {
  test("should register zero-argument prompt", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.prompt("test", async () => ({
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: "Test response",
          },
        },
      ],
    }));

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "prompts/list",
      },
      ListPromptsResultSchema,
    );

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].name).toBe("test");
    expect(result.prompts[0].arguments).toBeUndefined();
  });

  test("should register prompt with args schema", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.prompt(
      "test",
      {
        name: z.string(),
        value: z.string(),
      },
      async ({ name, value }) => ({
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `${name}: ${value}`,
            },
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "prompts/list",
      },
      ListPromptsResultSchema,
    );

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].name).toBe("test");
    expect(result.prompts[0].arguments).toEqual([
      { name: "name", required: true },
      { name: "value", required: true },
    ]);
  });

  test("should register prompt with description", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });
    const client = new Client({
      name: "test client",
      version: "1.0",
    });

    mcpServer.prompt("test", "Test description", async () => ({
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: "Test response",
          },
        },
      ],
    }));

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "prompts/list",
      },
      ListPromptsResultSchema,
    );

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].name).toBe("test");
    expect(result.prompts[0].description).toBe("Test description");
  });

  test("should validate prompt args", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          prompts: {},
        },
      },
    );

    mcpServer.prompt(
      "test",
      {
        name: z.string(),
        value: z.string().min(3),
      },
      async ({ name, value }) => ({
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `${name}: ${value}`,
            },
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    await expect(
      client.request(
        {
          method: "prompts/get",
          params: {
            name: "test",
            arguments: {
              name: "test",
              value: "ab", // Too short
            },
          },
        },
        GetPromptResultSchema,
      ),
    ).rejects.toThrow(/Invalid arguments/);
  });

  test("should prevent duplicate prompt registration", () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    mcpServer.prompt("test", async () => ({
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: "Test response",
          },
        },
      ],
    }));

    expect(() => {
      mcpServer.prompt("test", async () => ({
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: "Test response 2",
            },
          },
        ],
      }));
    }).toThrow(/already registered/);
  });

  test("should allow registering multiple prompts", () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    // This should succeed
    mcpServer.prompt("prompt1", async () => ({
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: "Test response 1",
          },
        },
      ],
    }));

    // This should also succeed and not throw about request handlers
    mcpServer.prompt("prompt2", async () => ({
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: "Test response 2",
          },
        },
      ],
    }));
  });

  test("should allow registering prompts with arguments", () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    // This should succeed
    mcpServer.prompt("echo", { message: z.string() }, ({ message }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please process this message: ${message}`,
          },
        },
      ],
    }));
  });

  test("should allow registering both resources and prompts with completion handlers", () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    // Register a resource with completion
    mcpServer.resource(
      "test",
      new ResourceTemplate("test://resource/{category}", {
        list: undefined,
        complete: {
          category: () => ["books", "movies", "music"],
        },
      }),
      async () => ({
        contents: [
          {
            uri: "test://resource/test",
            text: "Test content",
          },
        ],
      }),
    );

    // Register a prompt with completion
    mcpServer.prompt(
      "echo",
      { message: completable(z.string(), () => ["hello", "world"]) },
      ({ message }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please process this message: ${message}`,
            },
          },
        ],
      }),
    );
  });

  test("should throw McpError for invalid prompt name", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          prompts: {},
        },
      },
    );

    mcpServer.prompt("test-prompt", async () => ({
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: "Test response",
          },
        },
      ],
    }));

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    await expect(
      client.request(
        {
          method: "prompts/get",
          params: {
            name: "nonexistent-prompt",
          },
        },
        GetPromptResultSchema,
      ),
    ).rejects.toThrow(/Prompt nonexistent-prompt not found/);
  });

  test("should support completion of prompt arguments", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          prompts: {},
        },
      },
    );

    mcpServer.prompt(
      "test-prompt",
      {
        name: completable(z.string(), () => ["Alice", "Bob", "Charlie"]),
      },
      async ({ name }) => ({
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `Hello ${name}`,
            },
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "completion/complete",
        params: {
          ref: {
            type: "ref/prompt",
            name: "test-prompt",
          },
          argument: {
            name: "name",
            value: "",
          },
        },
      },
      CompleteResultSchema,
    );

    expect(result.completion.values).toEqual(["Alice", "Bob", "Charlie"]);
    expect(result.completion.total).toBe(3);
  });

  test("should support filtered completion of prompt arguments", async () => {
    const mcpServer = new McpServer({
      name: "test server",
      version: "1.0",
    });

    const client = new Client(
      {
        name: "test client",
        version: "1.0",
      },
      {
        capabilities: {
          prompts: {},
        },
      },
    );

    mcpServer.prompt(
      "test-prompt",
      {
        name: completable(z.string(), (test) =>
          ["Alice", "Bob", "Charlie"].filter((value) => value.startsWith(test)),
        ),
      },
      async ({ name }) => ({
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `Hello ${name}`,
            },
          },
        ],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    const result = await client.request(
      {
        method: "completion/complete",
        params: {
          ref: {
            type: "ref/prompt",
            name: "test-prompt",
          },
          argument: {
            name: "name",
            value: "A",
          },
        },
      },
      CompleteResultSchema,
    );

    expect(result.completion.values).toEqual(["Alice"]);
    expect(result.completion.total).toBe(1);
  });
});

describe("McpServer with Auth Extension", () => {
  type SessionUser = {
    role: string;
    [key: string]: unknown;
  };

  type AccessPolicy = {
    allow?: {
      roles?: string[];
    };
    deny?: {
      roles?: string[];
    };
  };

  type RegisteredToolWithAuth = {
    description?: string;
    inputSchema?: z.ZodObject<ZodRawShape>;
    callback: ToolCallback<ZodRawShape | undefined>;
    accessPolicy?: AccessPolicy;
  };

  // Just a simple extension to McpServer that adds support for access policies on tools
  class McpServerWithAuth extends McpServer {
    protected override _registeredTools: {
      [name: string]: RegisteredToolWithAuth;
    } = {};
    checkPermissions(user?: SessionUser, policy?: AccessPolicy): boolean {
      if (!policy) {
        return true;
      }

      if (!user) {
        return false;
      }

      // Check deny rules first
      if (policy.deny) {
        // Check denied roles
        if (policy.deny.roles?.includes(user.role)) {
          return false;
        }
      }

      // Check allow rules
      if (policy.allow) {
        let isAllowed = false;

        // If no allow rules are specified, default to allowed
        if (!policy.allow.roles) {
          isAllowed = true;
        } else {
          // Check allowed roles
          if (policy.allow.roles?.includes(user.role)) {
            isAllowed = true;
          }
        }

        return isAllowed;
      }

      // If no rules specified, default to allowed
      return true;
    }

    override tool(
      name: string,
      cb: ToolCallback,
      accessPolicy?: AccessPolicy,
    ): void;
    override tool(
      name: string,
      description: string,
      cb: ToolCallback,
      accessPolicy?: AccessPolicy,
    ): void;
    override tool<Args extends ZodRawShape>(
      name: string,
      paramsSchema: Args,
      cb: ToolCallback<Args>,
      accessPolicy?: AccessPolicy,
    ): void;
    override tool<Args extends ZodRawShape>(
      name: string,
      description: string,
      paramsSchema: Args,
      cb: ToolCallback<Args>,
      accessPolicy?: AccessPolicy,
    ): void;
    override tool(name: string, ...rest: unknown[]): void {
      let description: string | undefined;
      let paramsSchema: ZodRawShape | undefined;
      let accessPolicy: AccessPolicy | undefined;
      let cb: ToolCallback<ZodRawShape | undefined>;

      // Parse arguments based on their types
      if (typeof rest[0] === "function") {
        // Case: tool(name, cb, accessPolicy?)
        cb = rest[0] as ToolCallback<ZodRawShape | undefined>;
        accessPolicy = rest[1] as AccessPolicy | undefined;
      } else if (typeof rest[0] === "string") {
        // Cases with description
        description = rest[0];
        if (typeof rest[1] === "function") {
          // Case: tool(name, description, cb, accessPolicy?)
          cb = rest[1] as ToolCallback<ZodRawShape | undefined>;
          accessPolicy = rest[2] as AccessPolicy | undefined;
        } else {
          // Case: tool(name, description, paramsSchema, cb, accessPolicy?)
          paramsSchema = rest[1] as ZodRawShape;
          cb = rest[2] as ToolCallback<ZodRawShape>;
          accessPolicy = rest[3] as AccessPolicy | undefined;
        }
      } else {
        // Case: tool(name, paramsSchema, cb, accessPolicy?)
        paramsSchema = rest[0] as ZodRawShape;
        cb = rest[1] as ToolCallback<ZodRawShape>;
        accessPolicy = rest[2] as AccessPolicy | undefined;
      }

      // Register with base class
      const args: unknown[] = [name];
      if (description) args.push(description);
      if (paramsSchema) args.push(paramsSchema);
      args.push(cb);

      // Set up request handlers if not already initialized
      if (!this._toolHandlersInitialized) {
        this.server.assertCanSetRequestHandler(
          CallToolRequestSchema.shape.method.value,
        );
        this.server.assertCanSetRequestHandler(
          ListToolsRequestSchema.shape.method.value,
        );
        this.server.registerCapabilities({ tools: {} });

        // Add ListToolsRequestSchema handler
        this.server.setRequestHandler(
          ListToolsRequestSchema,
          (request, extra): ListToolsResult => {
            const user = extra.user as SessionUser | undefined;

            // Filter tools based on permissions
            const accessibleTools = Object.entries(this._registeredTools)
              .filter(([_, tool]) =>
                this.checkPermissions(user, tool.accessPolicy),
              )
              .map(
                ([name, tool]): Tool => ({
                  name,
                  description: tool.description,
                  inputSchema: tool.inputSchema
                    ? (zodToJsonSchema(tool.inputSchema, {
                      strictUnions: true,
                    }) as Tool["inputSchema"])
                    : { type: "object" },
                }),
              );

            return { tools: accessibleTools };
          },
        );

        this.server.setRequestHandler(
          CallToolRequestSchema,
          async (request: CallToolRequest, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
            const tool = this._registeredTools[request.params.name];
            if (!tool) {
              throw new Error(`Tool ${request.params.name} not found`);
            }

            if (
              !this.checkPermissions(
                extra.user as SessionUser,
                tool.accessPolicy,
              )
            ) {
              throw new Error(`Access denied for tool: ${request.params.name}`);
            }

            if (tool.inputSchema) {
              const parseResult = await tool.inputSchema.safeParseAsync(
                request.params.arguments,
              );
              if (!parseResult.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parseResult.error.message}`,
                );
              }

              const args = parseResult.data;
              const cb = tool.callback as ToolCallback<ZodRawShape>;
              return await Promise.resolve(cb(args, extra));
            } else {
              const cb = tool.callback as ToolCallback<undefined>;
              return await Promise.resolve(cb(extra));
            }
          },
        );
        this._toolHandlersInitialized = true;
      }

      McpServer.prototype.tool.apply(
        this,
        args as Parameters<typeof McpServer.prototype.tool>,
      );
      this._registeredTools[name].accessPolicy = accessPolicy;
    }
  }

  const mcpServer = new McpServerWithAuth({
    name: "test server with auth",
    version: "1.0",
  });
  const client = new Client({
    name: "test client",
    version: "1.0",
  });

  mcpServer.tool("public-tool", async () => ({
    content: [
      {
        type: "text",
        text: "Public tool response",
      },
    ],
  }));

  mcpServer.tool(
    "protected-tool",
    async () => ({
      content: [
        {
          type: "text",
          text: "Protected tool response",
        },
      ],
    }),
    {
      allow: {
        roles: ["admin"],
      },
    },
  );

  test("should public tools work with list and call when unauthenticated", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    // Public tool should be accessible
    const result = await client.request(
      { method: "tools/list" },
      ListToolsResultSchema,
    );
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("public-tool");
    const response = await client.request(
      {
        method: "tools/call",
        params: {
          name: "public-tool",
          arguments: {},
        },
      },
      CallToolResultSchema,
    );
    expect(response.content).toEqual([
      {
        type: "text",
        text: "Public tool response",
      },
    ]);
  });

  test("should public tools work with list and call when unauthorized", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    // Protected tool should be inaccessible when authenticated as a non-admin user
    serverTransport.user = { role: "member" };
    const result = await client.request(
      { method: "tools/list" },
      ListToolsResultSchema,
    );
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("public-tool");
    const response = await client.request(
      {
        method: "tools/call",
        params: {
          name: "public-tool",
          arguments: {},
        },
      },
      CallToolResultSchema,
    );
    expect(response.content).toEqual([
      {
        type: "text",
        text: "Public tool response",
      },
    ]);
  });

  test("should protected tools work with list and call when authorized", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      mcpServer.server.connect(serverTransport),
    ]);

    serverTransport.user = { role: "admin" };
    const result = await client.request(
      { method: "tools/list" },
      ListToolsResultSchema,
    );
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].name).toBe("public-tool");
    expect(result.tools[1].name).toBe("protected-tool");

    const response = await client.request(
      {
        method: "tools/call",
        params: {
          name: "protected-tool",
          arguments: {},
        },
      },
      CallToolResultSchema,
    );
    expect(response.content).toEqual([
      {
        type: "text",
        text: "Protected tool response",
      },
    ]);
  });
});
