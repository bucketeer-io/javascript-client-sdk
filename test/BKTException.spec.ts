import { suite, test, expect } from 'vitest'
import { toBKTException } from '../src/internal/remote/toBKTException'
import {
  BadRequestException,
  ClientClosedRequestException,
  ForbiddenException,
  InternalServerErrorException,
  InvalidHttpMethodException,
  NotFoundException,
  PayloadTooLargeException,
  RedirectRequestException,
  ServiceUnavailableException,
  TimeoutException,
  UnauthorizedException,
  UnknownException,
} from '../src/BKTExceptions'

suite('BKTException', () => {
  test.each([
    {
      statusCode: 300,
      responseText: 'Redirect Request',
      expectedError: new RedirectRequestException(300, 'Redirect Request'),
    },
    {
      statusCode: 302,
      responseText: 'Redirect Request',
      expectedError: new RedirectRequestException(302, 'Redirect Request'),
    },
    {
      statusCode: 399,
      responseText: 'Redirect Request',
      expectedError: new RedirectRequestException(399, 'Redirect Request'),
    },
    {
      statusCode: 400,
      responseText: 'Bad Request',
      expectedError: new BadRequestException('Bad Request'),
    },
    {
      statusCode: 400,
      responseText: 'Custom message',
      expectedError: new BadRequestException('Custom message'),
    },
    {
      statusCode: 401,
      responseText: '',
      expectedError: new UnauthorizedException(),
    },
    {
      statusCode: 401,
      responseText: 'Unauthorized',
      expectedError: new UnauthorizedException('Unauthorized'),
    },
    {
      statusCode: 403,
      responseText: 'Forbidden',
      expectedError: new ForbiddenException('Forbidden'),
    },
    {
      statusCode: 404,
      responseText: 'Feature Not Found',
      expectedError: new NotFoundException('Feature Not Found'),
    },
    {
      statusCode: 405,
      responseText: 'Invalid HTTP Method',
      expectedError: new InvalidHttpMethodException('Invalid HTTP Method'),
    },
    {
      statusCode: 408,
      responseText: 'Timeout with status 408',
      expectedError: new TimeoutException(0, 'Timeout with status 408'),
    },
    {
      statusCode: 413,
      responseText: 'Payload Too Large',
      expectedError: new PayloadTooLargeException('Payload Too Large'),
    },
    {
      statusCode: 499,
      responseText: 'Client Closed Request',
      expectedError: new ClientClosedRequestException('Client Closed Request'),
    },
    {
      statusCode: 500,
      responseText: 'Internal Server Error',
      expectedError: new InternalServerErrorException('Internal Server Error'),
    },
    {
      statusCode: 502,
      responseText: 'Service Unavailable',
      expectedError: new ServiceUnavailableException('Service Unavailable'),
    },
    {
      statusCode: 503,
      responseText: 'Service Unavailable',
      expectedError: new ServiceUnavailableException('Service Unavailable'),
    },
    {
      statusCode: 504,
      responseText: 'Service Unavailable',
      expectedError: new ServiceUnavailableException('Service Unavailable'),
    },
    {
      statusCode: 505,
      responseText: 'Some Random Message',
      expectedError: new UnknownException(
        'Unknown Error: 505 false, Some Random Message ,null',
        505,
      ),
    },
  ])('toBKTException', async ({ statusCode, responseText, expectedError }) => {
    const sampleResponse = {
      ok: false,
      headers: {
        get(name: string) {
          return name === 'Content-Type' ? 'application/json' : null
        },
      },
      status: statusCode,
      statusText: 'false',
      async json() {
        return { message: 'Sample JSON response' }
      },
      async text() {
        return responseText
      },
    }
    const error = await toBKTException(sampleResponse)
    expect(error, 'error should match').toStrictEqual(expectedError)
  })
})
