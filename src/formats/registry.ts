import type { FormatPlugin } from "./types";

const plugins = new Map<string, FormatPlugin>();

export function registerFormat(plugin: FormatPlugin): void {
  if (plugins.has(plugin.id)) throw new Error(`Format "${plugin.id}" is already registered`);
  plugins.set(plugin.id, plugin);
}

export function getFormat(id: string): FormatPlugin {
  const plugin = plugins.get(id);
  if (!plugin) throw new Error(`No plugin registered for format "${id}"`);
  return plugin;
}

export function registeredFormats(): FormatPlugin[] {
  return [...plugins.values()];
}
