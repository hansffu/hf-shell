declare module "gi://AstalBattery" {
  namespace AstalBattery {
    type SignalCallback = (...args: any[]) => void

    class Device {
      battery_icon_name: string
      charging: boolean
      is_battery: boolean
      is_present: boolean
      percentage: number
      time_to_empty: number
      time_to_full: number

      static get_default(): Device | null
      connect(signal: string, callback: SignalCallback): number
      disconnect(id: number): void
    }

    function get_default(): Device | null
  }

  export default AstalBattery
}
