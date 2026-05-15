import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import Panel, { PanelSection } from "./Panel"
import { setupPanelPopover } from "./PanelRevealer"

type CpuSnapshot = {
  idle: number
  total: number
}

type SystemSample = {
  cpu: number
  cpuTemp: number | null
  load: string
  memoryAvailable: number
  memoryTotal: number
  memoryUsed: number
  memoryUsage: number
  processCount: number
  uptime: string
}

type SystemMonitorControls = {
  button: Gtk.MenuButton
  compactCpuLabel: Gtk.Label
  compactCpuRow: Gtk.Widget
  compactMemoryLabel: Gtk.Label
  compactMemoryRow: Gtk.Widget
  compactTempIcon: TemperatureIcon
  compactTempLabel: Gtk.Label
  compactTempRow: Gtk.Widget
  cpuGraph: Gtk.DrawingArea
  cpuLabel: Gtk.Label
  cpuTempGraph: Gtk.DrawingArea
  cpuTempLabel: Gtk.Label
  loadLabel: Gtk.Label
  memoryAvailableLabel: Gtk.Label
  memoryGraph: Gtk.DrawingArea
  memoryLabel: Gtk.Label
  memoryUsedLabel: Gtk.Label
  processLabel: Gtk.Label
  uptimeLabel: Gtk.Label
}

type GraphContext = {
  arc(x: number, y: number, radius: number, angle1: number, angle2: number): void
  closePath(): void
  fill(): void
  lineTo(x: number, y: number): void
  moveTo(x: number, y: number): void
  rectangle(x: number, y: number, width: number, height: number): void
  setLineWidth(width: number): void
  setSourceRGBA(red: number, green: number, blue: number, alpha: number): void
  stroke(): void
}

type TemperatureIcon = {
  area: Gtk.DrawingArea
  setCritical(critical: boolean): void
}

const HISTORY_LIMIT = 90
const GRAPH_PADDING = 8
const cpuHistory: number[] = []
const cpuTempHistory: number[] = []
const memoryHistory: number[] = []
let previousCpuSnapshot: CpuSnapshot | null = null

function bytesToString(bytes: Uint8Array) {
  let output = ""

  for (const byte of bytes) output += String.fromCharCode(byte)

  return output
}

function readFile(path: string) {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)

    return ok ? bytesToString(bytes) : ""
  } catch (error) {
    void error
    return ""
  }
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatKib(kib: number) {
  const gib = kib / 1024 / 1024

  if (gib >= 1) return `${gib.toFixed(1)} GiB`

  return `${Math.round(kib / 1024)} MiB`
}

function formatTemperature(value: number | null) {
  return value === null ? "--" : `${Math.round(value)}°`
}

function listDirectory(path: string) {
  try {
    const dir = GLib.Dir.open(path, 0)
    const files: string[] = []
    let file = dir.read_name()

    while (file !== null) {
      files.push(GLib.build_filenamev([path, file]))
      file = dir.read_name()
    }

    dir.close()
    return files
  } catch (error) {
    void error
    return []
  }
}

function readCpuSnapshot(): CpuSnapshot | null {
  const cpuLine = readFile("/proc/stat")
    .split("\n")
    .find((line) => line.startsWith("cpu "))

  if (!cpuLine) return null

  const values = cpuLine
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number)
  const idle = (values[3] ?? 0) + (values[4] ?? 0)
  const total = values.reduce((sum, value) => sum + value, 0)

  return { idle, total }
}

function readCpuUsage() {
  const snapshot = readCpuSnapshot()

  if (!snapshot) return 0
  if (!previousCpuSnapshot) {
    previousCpuSnapshot = snapshot
    return 0
  }

  const total = snapshot.total - previousCpuSnapshot.total
  const idle = snapshot.idle - previousCpuSnapshot.idle

  previousCpuSnapshot = snapshot

  if (total <= 0) return 0

  return clamp(1 - idle / total)
}

function readMemory() {
  const values = new Map<string, number>()

  for (const line of readFile("/proc/meminfo").split("\n")) {
    const match = line.match(/^([^:]+):\s+(\d+)/)

    if (match) values.set(match[1], Number(match[2]))
  }

  const total = values.get("MemTotal") ?? 0
  const available = values.get("MemAvailable") ?? 0
  const used = Math.max(0, total - available)

  return {
    available,
    total,
    used,
    usage: total > 0 ? clamp(used / total) : 0,
  }
}

function readTemperatureInput(path: string) {
  const value = Number(readFile(path).trim())

  if (!Number.isFinite(value) || value <= 0) return null

  return value > 1000 ? value / 1000 : value
}

function readCpuTemperatureFromHwmon() {
  const values: number[] = []
  const cpuSensorNames = ["coretemp", "k10temp", "zenpower", "cpu", "acpi"]
  const cpuLabelParts = ["tctl", "tdie", "tccd", "package", "core", "cpu"]

  for (const hwmon of listDirectory("/sys/class/hwmon")) {
    const sensorName = readFile(GLib.build_filenamev([hwmon, "name"])).trim().toLowerCase()
    const sensorLooksRelevant = cpuSensorNames.some((name) => sensorName.includes(name))

    for (const input of listDirectory(hwmon).filter((file) => /temp\d+_input$/.test(file))) {
      const label = readFile(input.replace(/_input$/, "_label")).trim().toLowerCase()
      const labelLooksRelevant = cpuLabelParts.some((part) => label.includes(part))

      if (!sensorLooksRelevant && label && !labelLooksRelevant) continue
      if (!sensorLooksRelevant && !label) continue

      const value = readTemperatureInput(input)

      if (value !== null) values.push(value)
    }
  }

  return values.length > 0 ? Math.max(...values) : null
}

function readCpuTemperatureFromThermalZones() {
  const values: number[] = []
  const cpuTypeParts = ["x86_pkg_temp", "cpu", "k10temp", "coretemp", "acpitz"]

  for (const zone of listDirectory("/sys/class/thermal").filter((file) => file.includes("thermal_zone"))) {
    const type = readFile(GLib.build_filenamev([zone, "type"])).trim().toLowerCase()

    if (!cpuTypeParts.some((part) => type.includes(part))) continue

    const value = readTemperatureInput(GLib.build_filenamev([zone, "temp"]))

    if (value !== null) values.push(value)
  }

  return values.length > 0 ? Math.max(...values) : null
}

function readCpuTemperature() {
  return readCpuTemperatureFromHwmon() ?? readCpuTemperatureFromThermalZones()
}

function readLoad() {
  const [one = "0.00", five = "0.00", fifteen = "0.00"] = readFile("/proc/loadavg").split(/\s+/)

  return `${one} ${five} ${fifteen}`
}

function readProcessCount() {
  const match = readFile("/proc/loadavg").match(/\s\d+\/(\d+)\s/)

  return match ? Number(match[1]) : 0
}

function readUptime() {
  const seconds = Math.floor(Number(readFile("/proc/uptime").split(/\s+/)[0] ?? 0))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`

  return `${minutes}m`
}

function sampleSystem(): SystemSample {
  const memory = readMemory()

  return {
    cpu: readCpuUsage(),
    cpuTemp: readCpuTemperature(),
    load: readLoad(),
    memoryAvailable: memory.available,
    memoryTotal: memory.total,
    memoryUsed: memory.used,
    memoryUsage: memory.usage,
    processCount: readProcessCount(),
    uptime: readUptime(),
  }
}

function pushHistory(history: number[], value: number) {
  history.push(value)

  while (history.length > HISTORY_LIMIT) history.shift()
}

function setCritical(widget: Gtk.Widget, critical: boolean) {
  if (critical) widget.add_css_class("critical")
  else widget.remove_css_class("critical")
}

function createTemperatureIcon(): TemperatureIcon {
  const area = Gtk.DrawingArea.new()
  let critical = false

  area.add_css_class("system-monitor-temp-icon")
  area.set_content_width(17)
  area.set_content_height(17)
  area.set_draw_func((_area: Gtk.DrawingArea, cr: GraphContext, width: number, height: number) => {
    const [red, green, blue] = critical ? [1, 0.42, 0.42] : [0.73, 0.76, 0.81]
    const centerX = width / 2
    const tubeTop = 3
    const tubeBottom = height - 6

    cr.setSourceRGBA(red, green, blue, 0.95)
    cr.setLineWidth(2)
    cr.moveTo(centerX, tubeTop)
    cr.lineTo(centerX, tubeBottom)
    cr.stroke()

    cr.arc(centerX, height - 5, 3.3, 0, Math.PI * 2)
    cr.fill()

    cr.setLineWidth(1.4)
    cr.moveTo(centerX + 3.4, tubeTop + 1)
    cr.lineTo(centerX + 5.7, tubeTop + 1)
    cr.stroke()
    cr.moveTo(centerX + 3.4, tubeTop + 4)
    cr.lineTo(centerX + 5.2, tubeTop + 4)
    cr.stroke()
  })

  return {
    area,
    setCritical(next) {
      critical = next
      area.queue_draw()
    },
  }
}

function drawGraph(
  area: Gtk.DrawingArea,
  history: number[],
  hoverIndex: number | null,
  cr: GraphContext,
  width: number,
  height: number,
  red: number,
  green: number,
  blue: number,
) {
  const padding = GRAPH_PADDING
  const graphWidth = Math.max(1, width - padding * 2)
  const graphHeight = Math.max(1, height - padding * 2)
  const values = history.length > 0 ? history : [0]

  void area

  cr.setSourceRGBA(0.11, 0.12, 0.15, 1)
  cr.rectangle(0, 0, width, height)
  cr.fill()

  cr.setLineWidth(1)
  cr.setSourceRGBA(1, 1, 1, 0.08)
  for (const ratio of [0.25, 0.5, 0.75]) {
    const y = padding + graphHeight * ratio

    cr.moveTo(padding, y)
    cr.lineTo(width - padding, y)
    cr.stroke()
  }

  if (values.length === 1) {
    const y = padding + graphHeight * (1 - values[0])

    cr.setSourceRGBA(red, green, blue, 0.95)
    cr.arc(padding, y, 2, 0, Math.PI * 2)
    cr.fill()
    return
  }

  cr.setSourceRGBA(red, green, blue, 0.18)
  cr.moveTo(padding, height - padding)
  values.forEach((value, index) => {
    const x = padding + (graphWidth * index) / (values.length - 1)
    const y = padding + graphHeight * (1 - value)

    cr.lineTo(x, y)
  })
  cr.lineTo(width - padding, height - padding)
  cr.closePath()
  cr.fill()

  cr.setSourceRGBA(red, green, blue, 0.95)
  cr.setLineWidth(2)
  values.forEach((value, index) => {
    const x = padding + (graphWidth * index) / (values.length - 1)
    const y = padding + graphHeight * (1 - value)

    if (index === 0) cr.moveTo(x, y)
    else cr.lineTo(x, y)
  })
  cr.stroke()

  if (hoverIndex === null) return

  const index = Math.max(0, Math.min(values.length - 1, hoverIndex))
  const x = values.length === 1
    ? padding
    : padding + (graphWidth * index) / (values.length - 1)
  const y = padding + graphHeight * (1 - values[index])

  cr.setSourceRGBA(1, 1, 1, 0.24)
  cr.setLineWidth(1)
  cr.moveTo(x, padding)
  cr.lineTo(x, height - padding)
  cr.stroke()

  cr.setSourceRGBA(red, green, blue, 1)
  cr.arc(x, y, 3, 0, Math.PI * 2)
  cr.fill()
}

function createUsageGraph(
  history: number[],
  label: string,
  red: number,
  green: number,
  blue: number,
  formatValue = percent,
) {
  const area = Gtk.DrawingArea.new()
  const motion = Gtk.EventControllerMotion.new()
  let hoverIndex: number | null = null

  area.add_css_class("system-monitor-graph")
  area.set_content_width(280)
  area.set_content_height(82)
  area.set_draw_func((drawingArea: Gtk.DrawingArea, cr: GraphContext, width: number, height: number) => {
    drawGraph(drawingArea, history, hoverIndex, cr, width, height, red, green, blue)
  })
  motion.connect("motion", (_controller: Gtk.EventControllerMotion, x: number) => {
    const values = history.length > 0 ? history : [0]
    const width = Math.max(1, area.get_width())
    const graphWidth = Math.max(1, width - GRAPH_PADDING * 2)
    const ratio = Math.max(0, Math.min(1, (x - GRAPH_PADDING) / graphWidth))

    hoverIndex = values.length === 1 ? 0 : Math.round(ratio * (values.length - 1))
    area.set_tooltip_text(`${label} ${formatValue(values[hoverIndex])}`)
    area.queue_draw()
  })
  motion.connect("leave", () => {
    hoverIndex = null
    area.set_tooltip_text(null)
    area.queue_draw()
  })
  area.add_controller(motion)

  return area
}

function updateMonitor(controls: SystemMonitorControls) {
  const sample = sampleSystem()

  pushHistory(cpuHistory, sample.cpu)
  if (sample.cpuTemp !== null) pushHistory(cpuTempHistory, clamp(sample.cpuTemp / 100))
  pushHistory(memoryHistory, sample.memoryUsage)

  controls.compactCpuLabel.set_label(percent(sample.cpu))
  controls.compactMemoryLabel.set_label(percent(sample.memoryUsage))
  controls.compactTempLabel.set_label(formatTemperature(sample.cpuTemp))
  setCritical(controls.compactCpuRow, sample.cpu > 0.7)
  setCritical(controls.compactMemoryRow, sample.memoryUsage > 0.7)
  setCritical(controls.compactTempRow, sample.cpuTemp !== null && sample.cpuTemp >= 70)
  controls.compactTempIcon.setCritical(sample.cpuTemp !== null && sample.cpuTemp >= 70)
  controls.button.set_tooltip_text(
    `CPU ${percent(sample.cpu)} · Temp ${formatTemperature(sample.cpuTemp)} · Memory ${percent(sample.memoryUsage)}`,
  )
  controls.cpuLabel.set_label(percent(sample.cpu))
  controls.cpuTempLabel.set_label(formatTemperature(sample.cpuTemp))
  controls.memoryLabel.set_label(`${percent(sample.memoryUsage)} of ${formatKib(sample.memoryTotal)}`)
  controls.memoryUsedLabel.set_label(formatKib(sample.memoryUsed))
  controls.memoryAvailableLabel.set_label(formatKib(sample.memoryAvailable))
  controls.loadLabel.set_label(sample.load)
  controls.processLabel.set_label(String(sample.processCount))
  controls.uptimeLabel.set_label(sample.uptime)
  controls.cpuGraph.queue_draw()
  controls.cpuTempGraph.queue_draw()
  controls.memoryGraph.queue_draw()
}

function setupSystemMonitor(controls: SystemMonitorControls) {
  updateMonitor(controls)

  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    updateMonitor(controls)
    return GLib.SOURCE_CONTINUE
  })
}

function MetricRow({ label, value }: { label: string; value: Gtk.Label }) {
  return (
    <box class="system-monitor-metric" orientation={Gtk.Orientation.HORIZONTAL}>
      <label class="system-monitor-metric-label" xalign={0} hexpand label={label} />
      {value}
    </box>
  )
}

export default function SystemMonitor() {
  const cpuGraph = createUsageGraph(cpuHistory, "CPU", 0.32, 0.69, 0.94)
  const compactTempIcon = createTemperatureIcon()
  const cpuTempGraph = createUsageGraph(
    cpuTempHistory,
    "CPU temp",
    1,
    0.52,
    0.32,
    (value) => `${Math.round(value * 100)}°`,
  )
  const memoryGraph = createUsageGraph(memoryHistory, "Memory", 0.78, 0.47, 0.86)
  const controls: Partial<SystemMonitorControls> = {
    compactTempIcon,
    cpuGraph,
    cpuTempGraph,
    memoryGraph,
  }
  let setupDone = false

  const maybeSetup = () => {
    if (
      setupDone ||
      !controls.button ||
      !controls.compactCpuLabel ||
      !controls.compactCpuRow ||
      !controls.compactMemoryLabel ||
      !controls.compactMemoryRow ||
      !controls.compactTempIcon ||
      !controls.compactTempLabel ||
      !controls.compactTempRow ||
      !controls.cpuLabel ||
      !controls.cpuTempLabel ||
      !controls.loadLabel ||
      !controls.memoryAvailableLabel ||
      !controls.memoryLabel ||
      !controls.memoryUsedLabel ||
      !controls.processLabel ||
      !controls.uptimeLabel
    ) {
      return
    }

    setupDone = true
    setupSystemMonitor(controls as SystemMonitorControls)
  }

  return (
    <menubutton
      class="system-monitor"
      direction={Gtk.ArrowType.RIGHT}
      $={(button) => {
        controls.button = button
        maybeSetup()
      }}
    >
      <box class="system-monitor-content" orientation={Gtk.Orientation.VERTICAL}>
        <box
          class="system-monitor-compact-row cpu"
          orientation={Gtk.Orientation.VERTICAL}
          $={(row) => {
            controls.compactCpuRow = row
            maybeSetup()
          }}
        >
          <image iconName="power-profile-performance-symbolic" pixelSize={17} useFallback />
          <label
            class="system-monitor-cpu"
            $={(label) => {
              controls.compactCpuLabel = label
              maybeSetup()
            }}
          />
        </box>
        <box
          class="system-monitor-compact-row memory"
          orientation={Gtk.Orientation.VERTICAL}
          $={(row) => {
            controls.compactMemoryRow = row
            maybeSetup()
          }}
        >
          <image iconName="media-flash-symbolic" pixelSize={17} useFallback />
          <label
            class="system-monitor-memory"
            $={(label) => {
              controls.compactMemoryLabel = label
              maybeSetup()
            }}
          />
        </box>
        <box
          class="system-monitor-compact-row temp"
          orientation={Gtk.Orientation.VERTICAL}
          $={(row) => {
            controls.compactTempRow = row
            maybeSetup()
          }}
        >
          {compactTempIcon.area}
          <label
            class="system-monitor-temp"
            $={(label) => {
              controls.compactTempLabel = label
              maybeSetup()
            }}
          />
        </box>
      </box>
      <popover
        $={(popover: Gtk.Popover) => {
          setupPanelPopover(popover)
        }}
      >
        <Panel
          title="System Monitor"
          class="system-monitor-menu"
          headerEnd={<label class="system-monitor-subtitle" label="Live" />}
        >
          <PanelSection title="CPU">
            <box class="system-monitor-section" orientation={Gtk.Orientation.VERTICAL}>
              <MetricRow
                label="Usage"
                value={
                  <label
                    class="system-monitor-value"
                    $={(label) => {
                      controls.cpuLabel = label
                      maybeSetup()
                    }}
                  />
                }
              />
              <MetricRow
                label="Load average"
                value={
                  <label
                    class="system-monitor-value"
                    $={(label) => {
                      controls.loadLabel = label
                      maybeSetup()
                    }}
                  />
                }
              />
              {cpuGraph}
            </box>
          </PanelSection>
          <PanelSection title="CPU Temperature">
            <box class="system-monitor-section" orientation={Gtk.Orientation.VERTICAL}>
              <MetricRow
                label="Package"
                value={
                  <label
                    class="system-monitor-value"
                    $={(label) => {
                      controls.cpuTempLabel = label
                      maybeSetup()
                    }}
                  />
                }
              />
              {cpuTempGraph}
            </box>
          </PanelSection>
          <PanelSection title="Memory">
            <box class="system-monitor-section" orientation={Gtk.Orientation.VERTICAL}>
              <MetricRow
                label="Usage"
                value={
                  <label
                    class="system-monitor-value"
                    $={(label) => {
                      controls.memoryLabel = label
                      maybeSetup()
                    }}
                  />
                }
              />
              <MetricRow
                label="Used"
                value={
                  <label
                    class="system-monitor-value"
                    $={(label) => {
                      controls.memoryUsedLabel = label
                      maybeSetup()
                    }}
                  />
                }
              />
              <MetricRow
                label="Available"
                value={
                  <label
                    class="system-monitor-value"
                    $={(label) => {
                      controls.memoryAvailableLabel = label
                      maybeSetup()
                    }}
                  />
                }
              />
              {memoryGraph}
            </box>
          </PanelSection>
          <PanelSection title="System">
            <box class="system-monitor-section" orientation={Gtk.Orientation.VERTICAL}>
              <MetricRow
                label="Processes"
                value={
                  <label
                    class="system-monitor-value"
                    $={(label) => {
                      controls.processLabel = label
                      maybeSetup()
                    }}
                  />
                }
              />
              <MetricRow
                label="Uptime"
                value={
                  <label
                    class="system-monitor-value"
                    $={(label) => {
                      controls.uptimeLabel = label
                      maybeSetup()
                    }}
                  />
                }
              />
            </box>
          </PanelSection>
        </Panel>
      </popover>
    </menubutton>
  )
}
