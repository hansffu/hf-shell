import app from "ags/gtk4/app"
import style from "./style.scss"
import Bar from "./widget/Bar"
import NotificationPopups from "./widget/NotificationPopups"

type PromiseLikeResult = {
  catch?: (onRejected: (error: unknown) => void) => unknown
}

function logStartupError(error: unknown) {
  const runtime = globalThis as typeof globalThis & {
    logError?: (error: unknown, message?: string) => void
    print?: (message: string) => void
  }

  if (runtime.logError) {
    runtime.logError(error, "hf-shell startup failed")
  } else {
    runtime.print?.(`hf-shell startup failed: ${String(error)}`)
  }
}

function handleRejection(result: unknown) {
  const promise = result as PromiseLikeResult | null | undefined

  if (typeof promise?.catch === "function") void promise.catch(logStartupError)
}

const runtimeApp = app as typeof app & {
  runAsync?: (...args: unknown[]) => unknown
}
const runAsync = runtimeApp.runAsync?.bind(app)

if (runAsync) {
  // AGS start does not attach a rejection handler to the main loop promise.
  runtimeApp.runAsync = (...args: unknown[]) => {
    const result = runAsync(...args)

    handleRejection(result)
    return result
  }
}

try {
  const started: unknown = app.start({
    css: style,
    instanceName: "hf-shell",
    main() {
      const monitors = app.get_monitors()

      monitors.forEach(Bar)
      if (monitors[0]) {
        NotificationPopups(monitors[0])
      }
    },
  })

  handleRejection(started)
} catch (error) {
  logStartupError(error)
}
