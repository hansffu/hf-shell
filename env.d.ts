declare const SRC: string

declare module "inline:*" {
  const content: string
  export default content
}

declare module "gi://AstalNiri" {
  const AstalNiri: any
  export default AstalNiri
}

declare module "gi://AstalNotifd" {
  const AstalNotifd: any
  export default AstalNotifd
}

declare module "*.scss" {
  const content: string
  export default content
}

declare module "*.blp" {
  const content: string
  export default content
}

declare module "*.css" {
  const content: string
  export default content
}
