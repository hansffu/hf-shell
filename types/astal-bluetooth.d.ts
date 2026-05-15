declare module "gi://AstalBluetooth" {
  namespace AstalBluetooth {
    type SignalCallback = (...args: any[]) => void

    class Adapter {
      powered: boolean

      connect(signal: string, callback: SignalCallback): number
      disconnect(id: number): void
      get_powered(): boolean
      set_powered(value: boolean): void
    }

    class Device {
      address: string
      alias: string
      battery_percentage: number
      connected: boolean
      connecting: boolean
      name: string
      paired: boolean

      connect(signal: string, callback: SignalCallback): number
      connect_device(): Promise<void>
      disconnect(id: number): void
      disconnect_device(): Promise<void>
    }

    class Bluetooth {
      adapter: Adapter | null
      adapters: Adapter[]
      devices: Device[]
      is_connected: boolean
      is_powered: boolean

      static get_default(): Bluetooth
      connect(signal: string, callback: SignalCallback): number
      disconnect(id: number): void
      get_adapter(): Adapter | null
      get_devices(): Device[]
      get_is_connected(): boolean
      get_is_powered(): boolean
      toggle(): void
    }

    function get_default(): Bluetooth
  }

  export default AstalBluetooth
}
