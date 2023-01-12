export type FetchRequestLike = {
  method: string
  headers: { [key: string]: string }
  body: string
}

export type FetchResponseLike = {
  ok: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => Promise<any>
}

export type FetchLike = (
  url: string,
  request: FetchRequestLike
) => Promise<FetchResponseLike>
