#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { print } from "graphql/language/index.mjs";
import { buildSchema } from "graphql/utilities/index.mjs";
import { Console } from "node:console";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

globalThis.console = new Console(process.stderr);

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
GraphQL Schema Model Context Protocol Server

Usage: 
  node index.mjs [path/to/schema.graphqls]

Arguments:
  path/to/schema.graphqls  Path to the GraphQL schema file (optional)
                           If not provided, defaults to schema.graphqls

Examples:
  node index.mjs # Uses default schema.graphqls
  node index.mjs ../schema.shopify.2025-01.graphqls # Uses Shopify schema
  node index.mjs /absolute/path/to/custom-schema.graphqls
  `);
  process.exit(0);
}

const schemaArg = args[0];

const loadSchema = async () => {
  // Default to schema.graphqls if no argument provided
  const schemaPath = resolve(schemaArg ?? "schema.graphqls");

  let schemaContent;
  try {
    schemaContent = await readFile(schemaPath, { encoding: "utf-8" });
  } catch (_error) {
    console.error(`Error: Schema file not found at ${schemaPath}`);
    console.error("Usage: node index.mjs [path/to/schema.graphqls]");
    process.exit(1);
  }
  try {
    return buildSchema(schemaContent);
  } catch (error) {
    console.error(`Error loading schema: ${error.message}`);
    process.exit(1);
  }
};

const schema = await loadSchema();

// Extract schema name from file path for server identification
const schemaName = schemaArg ? schemaArg.split("/").pop().replace(".graphqls", "") : "schema";

const server = new McpServer({
  name: `GraphQL Schema: ${schemaName}`,
  version: "1.0.0",
  description: `Provides GraphQL schema information for ${schemaName}`,
});

const queryFields = schema.getQueryType()?.getFields();

if (queryFields) {
  server.tool(
    "list-query-fields",
    "Lists all of the available root-level fields for a GraphQL query.",
    () => ({
      content: [
        {
          type: "text",
          text: Object.keys(queryFields).join(", "),
        },
      ],
    }),
  );

  server.tool(
    "get-query-field",
    "Gets a single GraphQL query field definition in GraphQL Schema Definition Language.",
    { fieldName: z.string() },
    ({ fieldName }) => ({
      content: [
        {
          type: "text",
          text: queryFields[fieldName]?.astNode
            ? print(queryFields[fieldName].astNode)
            : "Field not found or has no definition",
        },
      ],
    }),
  );
}

const mutationFields = schema.getMutationType()?.getFields();

if (mutationFields) {
  server.tool(
    "list-mutation-fields",
    "Lists all of the available root-level fields for a GraphQL mutation.",
    () => {
      return {
        content: [
          {
            type: "text",
            text: Object.keys(mutationFields).join(", "),
          },
        ],
      };
    },
  );

  server.tool(
    "get-mutation-field",
    "Gets a single GraphQL mutation field definition in GraphQL Schema Definition Language.",
    { fieldName: z.string() },
    ({ fieldName }) => ({
      content: [
        {
          type: "text",
          text: mutationFields[fieldName]?.astNode
            ? print(mutationFields[fieldName].astNode)
            : "Field not found or has no definition",
        },
      ],
    }),
  );
}

const subscriptionFields = schema.getSubscriptionType()?.getFields();

if (subscriptionFields) {
  server.tool(
    "list-subscription-fields",
    "Lists all of the available root-level fields for a GraphQL subscription.",
    () => {
      return {
        content: [
          {
            type: "text",
            text: Object.keys(subscriptionFields).join(", "),
          },
        ],
      };
    },
  );

  server.tool(
    "get-subscription-field",
    "Gets a single GraphQL subscription field definition in GraphQL Schema Definition Language.",
    { fieldName: z.string() },
    ({ fieldName }) => ({
      content: [
        {
          type: "text",
          text: subscriptionFields[fieldName]?.astNode
            ? print(subscriptionFields[fieldName].astNode)
            : "Field not found or has no definition",
        },
      ],
    }),
  );
}

server.tool("list-types", "Lists all of the types defined in the GraphQL schema.", () => ({
  content: [
    {
      type: "text",
      // Filter out internal GraphQL types
      text: Object.keys(schema.getTypeMap())
        .filter((type) => !type.startsWith("__"))
        .join(", "),
    },
  ],
}));

server.tool(
  "get-type",
  "Gets a single GraphQL type from the schema in the GraphQL Schema Definition Language",
  { typeName: z.string() },
  ({ typeName }) => {
    let text;
    const type = schema.getTypeMap()[typeName];
    if (!type) {
      text = `Type "${typeName}" not found`;
    } else if (!type.astNode) {
      // Handle introspection types and other types without astNodes
      text = `Type: ${typeName}\nDescription: ${type.description ?? "No description"}\nKind: ${type.constructor.name}`;
    } else {
      text = print(type.astNode);
    }

    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "get-type-fields",
  "Gets a simplified list of fields for a specific GraphQL type",
  { typeName: z.string() },
  ({ typeName }) => {
    let text;
    const type = schema.getTypeMap()?.[typeName];
    if (!type) {
      text = `Type "${typeName}" not found`;
    } else if (!("getFields" in type)) {
      text = `Type "${typeName}" is not an object type with fields`;
    } else {
      text = Object.entries(type.getFields())
        .map(([fieldName, field]) => `${fieldName}: ${field.type.toString()}`)
        .join("\n");
    }

    return { content: [{ type: "text", text }] };
  },
);

// Add tool to search for types or fields by name pattern
server.tool(
  "search-schema",
  "Search for types or fields in the schema by name pattern",
  { pattern: z.string() },
  ({ pattern }) => {
    let text = "";
    const searchRegex = new RegExp(pattern, "i");

    // Search types
    const matchingTypes = Object.keys(schema.getTypeMap()).filter(
      (type) => !type.startsWith("__") && searchRegex.test(type),
    );
    text += `Matching types: ${matchingTypes.join(", ") || "None"}`;

    // Search fields in object types
    const matchingFields = Object.entries(schema.getTypeMap())
      .filter(([typeName]) => !typeName.startsWith("__"))
      .flatMap(([typeName, type]) =>
        "getFields" in type
          ? Object.keys(type.getFields())
              .filter((fieldName) => searchRegex.test(fieldName))
              .map((fieldName) => `${typeName}.${fieldName}`)
          : [],
      );
    text += `\nMatching fields: ${matchingFields.join(", ") || "None"}`;

    return { content: [{ type: "text", text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
