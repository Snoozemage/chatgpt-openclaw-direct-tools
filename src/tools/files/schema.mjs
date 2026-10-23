const string = (description) => ({ type: "string", description });
const integer = (description, extra = {}) => ({ type: "integer", description, ...extra });
const number = (description) => ({ type: "number", description });
const boolean = (description, extra = {}) => ({ type: "boolean", description, ...extra });

export const fileToolDefinitions = [
  {
    name: "openclaw_ls",
    description: "List files and directories using OpenClaw's native ls tool. Dotfiles and links are included. Use the returned after cursor with the same path to fetch the next page; use this tool before reading when the exact file path is unknown.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        path: string("Directory path. Omit to use OpenClaw's current working directory."),
        limit: number("Maximum number of directory entries to return; native default is 500."),
        after: string("Filename cursor returned by the previous page. Reuse it with the same path to continue listing."),
      },
    },
  },
  {
    name: "openclaw_read",
    description: "Read a text file or a supported image file through OpenClaw. Supported image formats include JPG, PNG, GIF, WebP and BMP; image content is attached to the model context. Text output is capped by the native tool (up to 2000 lines or 50 KB per read). Use offset and limit for line-based paging, or cursor to continue within a long line.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        path: string("Required file path, relative or absolute."),
        offset: integer("One-based starting line for text reads.", { minimum: 1 }),
        limit: number("Maximum number of lines to return."),
        cursor: integer("Zero-based character position within the starting line, used to continue a long line.", { minimum: 0 }),
        optional: boolean("When true, a missing path returns a structured not_found result instead of failing.", { const: true }),
      },
      required: ["path"],
    },
  },
  {
    name: "openclaw_edit",
    description: "Make targeted text replacements in one file with OpenClaw's native edit tool. Read the current file first. Each oldText must match the original content exactly, be unique and not overlap another edit. Combine nearby changes into one edit and avoid including large unchanged spans.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        path: string("Required file path, relative or absolute."),
        edits: {
          type: "array",
          description: "Targeted text replacements evaluated against the original file; edits must not overlap or nest.",
          items: {
            type: "object",
            properties: {
              oldText: string("Required exact text to find in the original file. It must be unique and not overlap other edits."),
              newText: string("Required replacement text."),
            },
            required: ["oldText", "newText"],
          },
        },
      },
      required: ["path", "edits"],
    },
  },
  {
    name: "openclaw_write",
    description: "Create or fully overwrite a file using OpenClaw's native write tool. Parent directories are created automatically. Use this only when replacing the whole file is intended; use openclaw_edit for localized changes.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        path: string("Required destination file path, relative or absolute."),
        content: string("Required complete file content to write."),
      },
      required: ["path", "content"],
    },
  },
  {
    name: "openclaw_apply_patch",
    description: "Apply an OpenClaw patch that can add, modify or delete one or more files. The input must use the native patch format with *** Begin Patch and *** End Patch markers. Prefer targeted changes and inspect the resulting summary.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        input: string("Required patch content using OpenClaw's *** Begin Patch / *** End Patch format."),
      },
      required: ["input"],
    },
  },
];
