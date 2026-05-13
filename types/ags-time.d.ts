declare module "ags/time" {
  import type { Accessor } from "gnim"

  export function createPoll<T = string>(initial: T, interval: number, command: string): Accessor<T>
}
