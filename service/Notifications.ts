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
  urgency: number
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

export type NotificationUrgency = "low" | "normal" | "critical"

export type NotificationPopup = {
  id: number
  notification: Notification
  urgency: NotificationUrgency
  timeoutMs: number
  remainingMs: Accessor<number>
  setRemainingMs: Setter<number>
  hovered: Accessor<boolean>
  setHovered: Setter<boolean>
  timerId: number
}

const LOW_POPUP_TIMEOUT_MS = 4000
const NORMAL_POPUP_TIMEOUT_MS = 6000
const CRITICAL_POPUP_TIMEOUT_MS = 0
const TICK_MS = 100
const IDLE_THRESHOLD_MS = 60_000

export const notifd = Notifd.get_default() as NotifdService
export const [records, setRecords] = createState<NotificationRecord[]>([])
export const [notificationCenterUnreadIds, setNotificationCenterUnreadIds] = createState<Set<number>>(new Set())
export const [popups, setPopups] = createState<NotificationPopup[]>([])
export const unreadCount = createComputed(
  () => records().filter((record) => !record.read).length,
)
export const hasPopups = createComputed(() => popups().length > 0)

let isUserIdle = false
let hasSeenActiveSession = false

export function notificationUrgency(notification: Notification): NotificationUrgency {
  if (notification.urgency === 0) return "low"
  if (notification.urgency === 2) return "critical"
  return "normal"
}

export function popupTimeoutFor(notification: Notification) {
  const urgency = notificationUrgency(notification)

  if (urgency === "low") return LOW_POPUP_TIMEOUT_MS
  if (urgency === "critical") return CRITICAL_POPUP_TIMEOUT_MS
  return NORMAL_POPUP_TIMEOUT_MS
}

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
  setNotificationCenterUnreadIds((current) => {
    const next = new Set(current)

    next.delete(id)
    return next
  })
  setRecords((current) =>
    current.map((record) => (record.id === id ? { ...record, read: true } : record)),
  )
}

export function markAllRead() {
  setNotificationCenterUnreadIds(new Set())
  setRecords((current) => current.map((record) => ({ ...record, read: true })))
}

export function clearRecord(id: number) {
  removePopup(id)
  setNotificationCenterUnreadIds((current) => {
    const next = new Set(current)

    next.delete(id)
    return next
  })
  setRecords((current) => current.filter((record) => record.id !== id))
}

export function clearAllRecords() {
  for (const popup of popups()) removePopup(popup.id)
  setNotificationCenterUnreadIds(new Set())
  setRecords([])
}

export function openNotificationCenter() {
  setNotificationCenterUnreadIds(
    new Set(records().filter((record) => !record.read).map((record) => record.id)),
  )
  setRecords((current) => current.map((record) => ({ ...record, read: true })))
}

export function closeNotificationCenter() {
  setNotificationCenterUnreadIds(new Set())
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
  setNotificationCenterUnreadIds(new Set())
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

  const urgency = notificationUrgency(notification)
  const timeoutMs = popupTimeoutFor(notification)
  const [remainingMs, setRemainingMs] = createState(timeoutMs)
  const [hovered, setHovered] = createState(false)
  const popup: NotificationPopup = {
    id: notification.id,
    notification,
    urgency,
    timeoutMs,
    remainingMs,
    setRemainingMs,
    hovered,
    setHovered,
    timerId: 0,
  }

  if (timeoutMs > 0) {
    popup.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
      if (hovered() || isUserIdle) return GLib.SOURCE_CONTINUE

      const nextRemaining = remainingMs() - TICK_MS
      setRemainingMs(Math.max(0, nextRemaining))

      if (nextRemaining > 0) return GLib.SOURCE_CONTINUE

      popup.timerId = 0
      removePopup(notification.id)
      return GLib.SOURCE_REMOVE
    })
  }

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
