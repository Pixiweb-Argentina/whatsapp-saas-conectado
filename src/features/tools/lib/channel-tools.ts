import type { Tool, ToolContext } from "../core/tool";

type ChannelToolContext = Pick<ToolContext, "channel" | "channelCapabilities">;

/** Existing tools are verified only for the legacy WA path until explicitly reviewed. */
export function toolSupportsChannel(tool: Tool, context: ChannelToolContext): boolean {
  const channel = context.channel ?? "whatsapp";
  if (!(tool.supportedChannels ?? ["whatsapp"]).includes(channel)) return false;
  return (tool.requiredChannelCapabilities ?? []).every((capability) =>
    context.channelCapabilities?.includes(capability) === true);
}

export function toolsForChannel(tools: Tool[], context: ChannelToolContext): Tool[] {
  return tools.filter((tool) => toolSupportsChannel(tool, context));
}
