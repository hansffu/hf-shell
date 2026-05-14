import app from "ags/gtk4/app"
import style from "./style.scss"
import Bar from "./widget/Bar"
import NotificationPopups from "./widget/NotificationPopups"

app.start({
  css: style,
  main() {
    const monitors = app.get_monitors()

    monitors.map(Bar)
    if (monitors[0]) {
      NotificationPopups(monitors[0])
    }
  },
})
