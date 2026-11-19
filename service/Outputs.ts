import { createState } from "gnim"

export type OutputInfo = {
  key: string
  connector: string | null
  label: string
}

// Connected outputs, published by the shell window sync in app.ts.
export const [outputs, setOutputs] = createState<OutputInfo[]>([])

// Key of the output currently hosting notification popups and the system tray.
export const [primaryOutputKey, setPrimaryOutputKey] = createState<string | null>(null)

// Connector picked in the settings panel. null means automatic (config.toml, then default rule).
// Kept in memory only; it resets when the shell restarts.
export const [primaryOutputSetting, setPrimaryOutputSetting] = createState<string | null>(null)
