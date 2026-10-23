declare module "ags/file" {
  export function readFile(path: string): string
  export function readFileAsync(path: string): Promise<string>
}
