import Gio from "gi://Gio"
import GObject from "gi://GObject"
import GLib from "gi://GLib"
import Notifd from "gi://AstalNotifd"
import { createComputed, createState } from "gnim"
import type { Accessor, Setter } from "gnim"

export type NotificationAction = GObject.Object & {
  id: string
  label: string
  invoke(): void
}

export type Notification = GObject.Object & {
  id: number
  app_name: string
  app_icon: string
  summary: string
  body: string
  desktop_entry: string
  image: string
  actions: NotificationAction[]
  dismiss(): void
}

export type NotifdService = GObject.Object & {
  dont_disturb: boolean
  connect(signal: "notified", callback: (_service: NotifdService, id: number) => void): number
  connect(signal: "resolved", callback: (_service: NotifdService, id: number) => void): number
  get_notification(id: number): Notification | null
}

export type NotificationRecord = {
  id: number
  notification: Notification
  receivedAt: number
  read: boolean
  resolved: boolean
}

export type NotificationPopup = {
  id: number
  notification: Notification
  remainingMs: Accessor<number>
  setRemainingMs: Setter<number>
  hovered: Accessor<boolean>
  setHovered: Setter<boolean>
  timerId: number
}

const POPUP_TIMEOUT_MS = 6000
const TICK_MS = 100
const IDLE_THRESHOLD_MS = 60_000

export const notifd = Notifd.get_default() as NotifdService
export const popupTimeoutMs = POPUP_TIMEOUT_MS
export const [records, setRecords] = createState<NotificationRecord[]>([])
export const [popups, setPopups] = createState<NotificationPopup[]>([])
export const unreadCount = createComputed(
  () => records().filter((record) => !record.read).length,
)
export const hasPopups = createComputed(() => popups().length > 0)

let isUserIdle = false
let hasSeenActiveSession = false

function sessionIdleMs() {
  try {
    const result = Gio.DBus.session.call_sync(
      "org.freedesktop.ScreenSaver",
      "/org/freedesktop/ScreenSaver",
      "org.freedesktop.ScreenSaver",
      "GetSessionIdleTime",
      null,
      new GLib.VariantType("(u)"),
      Gio.DBusCallFlags.NONE,
      100,
      null,
    )

    return (result?.deepUnpack() as [number] | null)?.[0] ?? 0
  } catch {
    return null
  }
}

function updateIdleState() {
  const idleMs = sessionIdleMs()

  if (idleMs === null) {
    isUserIdle = false
    return
  }

  if (idleMs < IDLE_THRESHOLD_MS) hasSeenActiveSession = true
  isUserIdle = hasSeenActiveSession && idleMs >= IDLE_THRESHOLD_MS
}

function upsertRecord(notification: Notification) {
  const receivedAt = Date.now()

  setRecords((current) => [
    {
      id: notification.id,
      notification,
      receivedAt,
      read: false,
      resolved: false,
    },
    ...current.filter((record) => record.id !== notification.id),
  ])
}

export function markRead(id: number) {
  setRecords((current) =>
    current.map((record) => (record.id === id ? { ...record, read: true } : record)),
  )
}

export function markAllRead() {
  setRecords((current) => current.map((record) => ({ ...record, read: true })))
}

export function clearRecord(id: number) {
  removePopup(id)
  setRecords((current) => current.filter((record) => record.id !== id))
}

export function clearAllRecords() {
  for (const popup of popups()) removePopup(popup.id)
  setRecords([])
}

export function dismissNotification(id: number) {
  removePopup(id)

  const record = records().find((item) => item.id === id)
  record?.notification.dismiss()

  setRecords((current) =>
    current.map((item) => (item.id === id ? { ...item, resolved: true } : item)),
  )
}

export function dismissAllNotifications() {
  for (const record of records()) record.notification.dismiss()
  for (const popup of popups()) removePopup(popup.id)
  setRecords((current) => current.map((record) => ({ ...record, resolved: true })))
}

export function setPopupHover(id: number, hovered: boolean) {
  popups().find((popup) => popup.id === id)?.setHovered(hovered)
}

export function removePopup(id: number) {
  setPopups((current) => {
    for (const popup of current) {
      if (popup.id === id && popup.timerId !== 0) {
        GLib.source_remove(popup.timerId)
        popup.timerId = 0
      }
    }

    return current.filter((popup) => popup.id !== id)
  })
}

function addPopup(notification: Notification) {
  removePopup(notification.id)

  const [remainingMs, setRemainingMs] = createState(POPUP_TIMEOUT_MS)
  const [hovered, setHovered] = createState(false)
  const popup: NotificationPopup = {
    id: notification.id,
    notification,
    remainingMs,
    setRemainingMs,
    hovered,
    setHovered,
    timerId: 0,
  }

  popup.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
    if (hovered() || isUserIdle) return GLib.SOURCE_CONTINUE

    const nextRemaining = remainingMs() - TICK_MS
    setRemainingMs(Math.max(0, nextRemaining))

    if (nextRemaining > 0) return GLib.SOURCE_CONTINUE

    popup.timerId = 0
    removePopup(notification.id)
    return GLib.SOURCE_REMOVE
  })

  setPopups((current) => [popup, ...current])
}

function resolveNotification(id: number) {
  removePopup(id)
  setRecords((current) =>
    current.map((record) => (record.id === id ? { ...record, resolved: true } : record)),
  )
}

GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
  updateIdleState()
  return GLib.SOURCE_CONTINUE
})

notifd.connect("notified", (_service, id) => {
  if (notifd.dont_disturb) return

  const notification = notifd.get_notification(id)
  if (!notification) return

  upsertRecord(notification)
  addPopup(notification)
})

notifd.connect("resolved", (_service, id) => {
  resolveNotification(id)
})
