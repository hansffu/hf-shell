declare module "gnim" {
  import GObject from "gi://GObject"

  export interface Accessor<T = unknown> {
    (): T
    as<U>(transform: (value: T) => U): Accessor<U>
  }

  export type Setter<T> = (value: T | ((current: T) => T)) => void

  export function createBinding<TObject extends object, TProp extends keyof TObject & string>(
    object: TObject,
    property: TProp,
  ): Accessor<TObject[TProp]>

  export function createBinding<T = unknown>(
    object: GObject.Object | unknown,
    property: string,
    ...properties: string[]
  ): Accessor<T>

  export function createComputed<T = unknown>(producer: () => T): Accessor<T>
  export function createState<T>(initial: T): [Accessor<T>, Setter<T>]

  export function For<Item = unknown>({
    each,
    children,
  }: {
    each: Accessor<Iterable<Item>>
    children: (item: Item, index: Accessor<number>) => JSX.Element
  }): JSX.Element
}
