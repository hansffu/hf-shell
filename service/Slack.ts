import AstalNiri from "gi://AstalNiri"
import AstalTray from "gi://AstalTray"
import GLib from "gi://GLib"
import { createState } from "gnim"

type SlackSource = {
  count: number
  urgent: boolean
}

export type SlackWorkspaceUnread = {
  count: number
  domain: string
  highlights: number
  name: string
  order: number
  teamId: string
}

const noUnreadPattern = /\b(no|0)\s+unread\b/i
const countPatterns = [
  /\((\d+)\)/,
  /\b(\d+)\s+(?:unread|notification|notifications|mention|mentions|message|messages|new item|new items)\b/i,
  /\b(?:unread|notification|notifications|mention|mentions|message|messages|new item|new items)\D+(\d+)\b/i,
]

export const [slackJsonUnreadCount, setSlackJsonUnreadCount] = createState(0)
export const [slackJsonUnreadWorkspaces, setSlackJsonUnreadWorkspaces] = createState<
  SlackWorkspaceUnread[]
>([])

function bytesToString(bytes: Uint8Array) {
  let output = ""

  for (const byte of bytes) output += String.fromCharCode(byte)

  return output
}

function slackRootStatePath() {
  return GLib.build_filenamev([
    GLib.get_user_config_dir(),
    "Slack",
    "storage",
    "root-state.json",
  ])
}

function readSlackRootState() {
  try {
    const [ok, bytes] = GLib.file_get_contents(slackRootStatePath())

    if (!ok) return null
    return JSON.parse(bytesToString(bytes)) as {
      webapp?: {
        teams?: Record<
          string,
          {
            unreads?: {
              showBullet?: boolean
              unreadHighlights?: number
              unreads?: number
            }
          }
        >
      }
      workspaces?: Record<
        string,
        {
          domain?: string
          name?: string
          order?: number
        }
      >
    }
  } catch (error) {
    void error
    return null
  }
}

function readSlackJsonUnreadCount() {
  const state = readSlackRootState()
  const teams = state?.webapp?.teams ?? {}
  const workspaces = state?.workspaces ?? {}
  const perTeam = Object.entries(teams).map(([teamId, team]) => {
    const unreads = team.unreads
    const workspace = workspaces[teamId]
    const count = unreads?.unreads ?? (unreads?.showBullet ? 1 : 0)

    return {
      count: Math.max(0, count),
      domain: workspace?.domain ?? "",
      highlights: Math.max(0, unreads?.unreadHighlights ?? 0),
      name: workspace?.name ?? teamId,
      order: workspace?.order ?? Number.MAX_SAFE_INTEGER,
      teamId,
    }
  }).sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
  const count = perTeam.reduce((total, team) => total + team.count, 0)

  setSlackJsonUnreadWorkspaces(perTeam)
  return count
}

function refreshSlackJsonUnreadCount() {
  setSlackJsonUnreadCount(readSlackJsonUnreadCount())

  return GLib.SOURCE_CONTINUE
}

refreshSlackJsonUnreadCount()
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, refreshSlackJsonUnreadCount)

function textFromParts(parts: Array<string | null | undefined>) {
  return parts.filter((part) => part && part.trim().length > 0).join(" ")
}

function parseUnreadText(text: string): SlackSource {
  if (!text || noUnreadPattern.test(text)) return { count: 0, urgent: false }

  for (const pattern of countPatterns) {
    const match = text.match(pattern)
    const count = Number(match?.[1] ?? 0)

    if (count > 0) return { count, urgent: true }
  }

  return {
    count: /\bunread\b/i.test(text) ? 1 : 0,
    urgent: /\bunread\b/i.test(text),
  }
}

function trayText(item: AstalTray.TrayItem) {
  return textFromParts([item.get_id(), item.get_title(), item.get_tooltip_text()])
}

function windowText(window: AstalNiri.Window) {
  return textFromParts([window.app_id, window.title])
}

function isSlackText(text: string) {
  return /\bslack\b/i.test(text)
}

function isUnreadNotificationText(text: string) {
  return /\bunread\b/i.test(text) && /\bnotification|notifications\b/i.test(text)
}

function slackTraySource(item: AstalTray.TrayItem): SlackSource | null {
  const text = trayText(item)

  if (!isSlackText(text)) return null
  return parseUnreadText(text)
}

function slackWindowSource(window: AstalNiri.Window): SlackSource | null {
  const text = windowText(window)

  if (!isSlackText(text)) return null
  return parseUnreadText(text)
}

export function hasSlackTrayItem(
  trayItems: AstalTray.TrayItem[] | null,
  windows: AstalNiri.Window[] | null,
) {
  const items = trayItems ?? []

  if (items.some((item) => isSlackText(trayText(item)))) return true
  if (items.some((item) => isUnreadNotificationText(trayText(item)))) return true

  return (windows ?? []).some((window) => isSlackText(windowText(window)))
}

export function slackUnreadCount(
  trayItems: AstalTray.TrayItem[] | null,
  windows: AstalNiri.Window[] | null,
) {
  const hasSlackWindow = (windows ?? []).some((window) => isSlackText(windowText(window)))
  const sources = [
    ...(trayItems ?? []).map(slackTraySource),
    ...(hasSlackWindow
      ? (trayItems ?? [])
          .filter((item) => isUnreadNotificationText(trayText(item)))
          .map((item) => parseUnreadText(trayText(item)))
      : []),
    ...(windows ?? []).map(slackWindowSource),
  ].filter((source): source is SlackSource => source !== null)

  return sources.reduce((count, source) => Math.max(count, source.count), 0)
}

export function slackTrayItem(trayItems: AstalTray.TrayItem[] | null) {
  return (trayItems ?? []).find((item) => isSlackText(trayText(item))) ?? null
}

export function slackWindow(windows: AstalNiri.Window[] | null) {
  return (windows ?? []).find((window) => isSlackText(windowText(window))) ?? null
}
