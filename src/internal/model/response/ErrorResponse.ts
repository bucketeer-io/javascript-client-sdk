export interface ErrorDetail {
  code: number
  message: string
}

export interface ErrorResponse {
  error: ErrorDetail
}
