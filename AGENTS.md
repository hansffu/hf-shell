# Project Instructions

This shell is an AGS application built with Gnim JSX and Astal libraries. Prefer that stack wherever it fits the task.

## Architecture

- Use AGS for the application shell and GTK4/layer-shell integration.
- Use Gnim JSX for widgets, composition, conditional rendering, list rendering, bindings, and local reactive UI state.
- Use Astal libraries for system integration such as notifications, Bluetooth, tray, WirePlumber audio, and compositor state.
- Keep durable application state in `service/` modules. Widgets should read service state and send user intent back to services.
- Do not keep long-lived application state only inside rendered components. Component-local state is fine for transient UI mechanics that disappear with the component.
- Prefer `createState`, `createComputed`, and `createBinding` over manual signal wiring when a property can be modeled as an `Accessor`.
- Prefer `<With>` for conditional mount/unmount behavior and `<For>` for dynamic lists.
- Wrap `<With>` and `<For>` in a stable container when sibling ordering or GTK measurement matters.
- Use widget `visible={accessor}` when a subtree can stay mounted cheaply. Use `<With>` when hidden content should not exist while closed.
- Use imperative GTK APIs only when GTK requires an explicit lifecycle hook or JSX cannot express the behavior clearly.

## Examples

Service-owned state:

```ts
// service/Notifications.ts
export const [notificationCenterOpen, setNotificationCenterOpen] = createState(false)

export function openNotificationCenter() {
  setNotificationCenterOpen(true)
  // snapshot/update service-owned notification state here
}

export function closeNotificationCenter() {
  setNotificationCenterOpen(false)
}
```

Conditional JSX rendering:

```tsx
// widget/NotificationButton.tsx
<popover>
  <box widthRequest={384} heightRequest={1}>
    <With value={notificationCenterOpen}>
      {(open) => open ? <NotificationCenter onClose={() => popover?.popdown()} /> : null}
    </With>
  </box>
</popover>
```

Derived UI state with text in markup:

```tsx
const unreadNotifications = createComputed(() => unreadCount())

<label>
  <With value={unreadNotifications}>
    {(unread) => unread === 0 ? "Notifications" : `Notifications (${unread})`}
  </With>
</label>
```

GObject/Astal property binding:

```ts
const dnd = createBinding(notifd, "dont_disturb")
```

List rendering from service state:

```tsx
<For each={records}>
  {(record) => <NotificationCard notification={record.notification} />}
</For>
```

Static visibility when the subtree can stay mounted:

```tsx
<PanelSection visible={createComputed(() => records().length > 0)}>
  ...
</PanelSection>
```

## References

- AGS quick start: https://aylur.github.io/ags/guide/quick-start.html
- AGS migration guide: https://aylur.github.io/ags/guide/migration-guide.html
- AGS resources: https://aylur.github.io/ags/guide/resources.html
- Gnim JSX and state: https://aylur.github.io/gnim/jsx
- Astal introduction and libraries: https://aylur.github.io/astal/guide/introduction
