export type HeadersLike = {
  get(name: string): string | null
}

export type FetchRequestLike = {
  method: string
  headers: { [key: string]: string }
  body: string
  signal?: AbortSignal
}

export type FetchResponseLike = {
  ok: boolean
  headers: HeadersLike
  status: number
  statusText: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => Promise<any>
  text: () => Promise<string>
}

export type FetchLike = (
  url: string,
  request: FetchRequestLike,
) => Promise<FetchResponseLike>
