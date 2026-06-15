import { app } from 'electron'

const DISCORD_BOT_SOURCE = 'https://github.com/CherryHQ/cherry-studio-pi'

export function buildDiscordUserAgent(version = app.getVersion()): string {
  return `DiscordBot (${DISCORD_BOT_SOURCE}, ${version})`
}
