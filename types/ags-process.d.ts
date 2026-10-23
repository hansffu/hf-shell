declare module "ags/process" {
  export function exec(cmd: string | string[]): string
  export function execAsync(cmd: string | string[]): Promise<string>
}
