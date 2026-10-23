export const IMAGE_RENDER_RESOURCE_URI = "ui://openclaw/image-render/v4.html";

export const imageRenderToolDefinition = {
  name: "openclaw_image_render",
  description: "Render a previously captured desktop screenshot in the ChatGPT UI. Call openclaw_computer with action=snapshot first, then pass its screenshot_ref. References expire after five minutes and are kept only in the bridge process.",
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      screenshot_ref: {
        type: "string",
        pattern: "^scr_[a-f0-9]{24}$",
        description: "Screenshot reference returned by openclaw_computer action=snapshot.",
      },
    },
    required: ["screenshot_ref"],
    additionalProperties: false,
  },
  _meta: {
    ui: { resourceUri: IMAGE_RENDER_RESOURCE_URI },
    "openai/outputTemplate": IMAGE_RENDER_RESOURCE_URI,
  },
};
