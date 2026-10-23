function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function compactCatalogEntry(tool, group) {
  return {
    id: tool.id,
    label: tool.label ?? tool.id,
    description: tool.description ?? null,
    ...(typeof tool.fullDescription === "string" ? { fullDescription: tool.fullDescription } : {}),
    source: tool.source ?? group.source ?? "unknown",
    ...(tool.pluginId ?? group.pluginId ? { pluginId: tool.pluginId ?? group.pluginId } : {}),
    groupId: group.id,
    groupLabel: group.label,
    ...(Array.isArray(tool.defaultProfiles) ? { defaultProfiles: tool.defaultProfiles } : {}),
    ...(tool.optional !== undefined ? { optional: tool.optional } : {}),
    ...(tool.risk !== undefined ? { risk: tool.risk } : {}),
    ...(Array.isArray(tool.tags) ? { tags: tool.tags } : {}),
    ...(Array.isArray(tool.parameters) ? { parameterSummary: cloneJson(tool.parameters) } : {}),
    schemaStatus: "not-present-in-exported-runtime-surface",
  };
}

/**
 * Convert the installed runtime's constructed tool object into a JSON-only record.
 * Runtime executors and other implementation functions must never be serialized.
 */
export function normalizeRuntimeTool(tool, catalogEntry = null) {
  if (!tool || typeof tool.name !== "string" || !tool.name.trim()) {
    throw new TypeError("Every runtime tool must have a non-empty name.");
  }
  if (!tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)) {
    throw new TypeError(`Runtime tool "${tool.name}" has no object input schema.`);
  }

  const result = {
    name: tool.name,
    label: typeof tool.label === "string" ? tool.label : tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: cloneJson(tool.parameters),
    ...(tool.outputSchema && typeof tool.outputSchema === "object"
      ? { outputSchema: cloneJson(tool.outputSchema) }
      : {}),
    ...(typeof tool.displaySummary === "string" ? { displaySummary: tool.displaySummary } : {}),
    ...(typeof tool.executionMode === "string" ? { executionMode: tool.executionMode } : {}),
    schemaStatus: "full-runtime-schema",
  };

  if (catalogEntry) {
    result.catalogMetadata = {
      id: catalogEntry.id,
      source: catalogEntry.source,
      groupId: catalogEntry.groupId,
      groupLabel: catalogEntry.groupLabel,
      ...(catalogEntry.pluginId ?? catalogEntry.groupPluginId ? { pluginId: catalogEntry.pluginId ?? catalogEntry.groupPluginId } : {}),
      ...(catalogEntry.defaultProfiles ? { defaultProfiles: cloneJson(catalogEntry.defaultProfiles) } : {}),
      ...(catalogEntry.description ? { summaryDescription: catalogEntry.description } : {}),
    };
  } else {
    result.catalogMetadata = null;
  }
  return result;
}

export function flattenCatalog(catalog) {
  const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
  return groups.flatMap((group) => (Array.isArray(group.tools) ? group.tools : []).map((tool) => ({
    ...tool,
    groupId: group.id,
    groupLabel: group.label,
    groupSource: group.source,
    groupPluginId: group.pluginId,
  })));
}

function descriptionsMatch(runtimeDescription, catalogDescription) {
  const normalize = (value) => String(value ?? "").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
  const runtime = normalize(runtimeDescription);
  const catalog = normalize(catalogDescription);
  return Boolean(runtime && catalog && (runtime === catalog || runtime.includes(catalog) || catalog.includes(runtime)));
}

function matchCatalogEntry(runtimeTool, candidates) {
  if (candidates.length === 1) return candidates[0];

  // Name alone is insufficient when the configurable catalog has duplicate ids
  // (for example, a core Browser tool and a Browser plugin tool).
  const matches = candidates.filter((entry) => descriptionsMatch(runtimeTool.description, entry.description));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Assemble a clear report separating exact schemas from catalog-only summaries.
 */
export function buildSchemaExport({ tools, catalog = null, exportedAt = new Date().toISOString(), openclawVersion = "unknown", agentId = "main", factoryModule = null, catalogError = null }) {
  if (!Array.isArray(tools)) throw new TypeError("Runtime tools must be an array.");
  if (tools.length === 0) throw new Error("OpenClaw runtime returned zero tools; refusing to create an empty export.");

  const catalogEntries = flattenCatalog(catalog);
  const catalogById = new Map();
  for (const entry of catalogEntries) {
    const candidates = catalogById.get(entry.id) ?? [];
    candidates.push(entry);
    catalogById.set(entry.id, candidates);
  }

  const runtimeNames = new Set();
  const matchedCatalogEntries = new Set();
  const exportedTools = tools.map((tool) => {
    if (runtimeNames.has(tool.name)) throw new Error(`Duplicate runtime tool name: ${tool.name}`);
    runtimeNames.add(tool.name);
    const candidate = matchCatalogEntry(tool, catalogById.get(tool.name) ?? []);
    if (candidate) matchedCatalogEntries.add(candidate);
    return normalizeRuntimeTool(tool, candidate);
  });

  const catalogOnly = catalogEntries
    .filter((entry) => !matchedCatalogEntries.has(entry))
    .map((entry) => compactCatalogEntry(entry, {
      id: entry.groupId,
      label: entry.groupLabel,
      source: entry.groupSource,
      pluginId: entry.groupPluginId,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const sourceCounts = {};
  for (const entry of catalogEntries) {
    const source = entry.source ?? entry.groupSource ?? "unknown";
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }

  return {
    format: "openclaw-tool-schema-export",
    formatVersion: 1,
    exportedAt,
    runtime: {
      openclawVersion,
      agentId,
      toolFactoryModule: factoryModule,
      schemaSource: "createOpenClawCodingToolsAsync from the installed OpenClaw runtime (internal, version-sensitive API)",
      catalogSource: catalog ? "OpenClaw Gateway tools.catalog" : null,
    },
    summary: {
      fullSchemaCount: exportedTools.filter((tool) => tool.schemaStatus === "full-runtime-schema").length,
      runtimeToolCount: exportedTools.length,
      catalogEntryCount: catalogEntries.length,
      catalogEntriesWithFullSchema: matchedCatalogEntries.size,
      catalogEntriesWithoutFullSchema: catalogOnly.length,
      allCatalogEntriesHaveFullSchema: Boolean(catalog) && catalogOnly.length === 0,
      catalogSourceCounts: sourceCounts,
      ...(catalogError ? { catalogWarning: catalogError } : {}),
      note: catalogOnly.length
        ? "The runtime factory returned exact schemas only for tools constructed in this runtime context. catalogEntriesWithoutFullSchema contains metadata summaries, not fabricated or inferred schemas."
        : "Every catalog entry matched a runtime tool with an exact input schema.",
    },
    catalogProfiles: Array.isArray(catalog?.profiles) ? cloneJson(catalog.profiles) : [],
    tools: exportedTools,
    catalogEntriesWithoutFullSchema: catalogOnly,
  };
}
