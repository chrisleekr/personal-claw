/**
 * Extracts structured properties from any error for LogTape structured logging.
 * Handles standard Error, Vercel AI SDK errors (APICallError, etc.), and unknown values.
 *
 * Usage: logger.error('Something failed', { context, ...errorDetails(error) });
 */
export function errorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { error: String(error) };
  }

  const details: Record<string, unknown> = {
    error: error.message,
    stack: error.stack,
  };

  if (error.name !== 'Error') {
    details.errorName = error.name;
  }

  if ('statusCode' in error) details.statusCode = error.statusCode;
  if ('url' in error) details.url = error.url;
  if ('isRetryable' in error) details.isRetryable = error.isRetryable;

  if ('responseBody' in error) {
    const body = String(error.responseBody);
    details.responseBody = body.length > 2000 ? `${body.slice(0, 2000)}...[truncated]` : body;
  }

  if (error.cause instanceof Error) {
    details.cause = error.cause.message;
    details.causeStack = error.cause.stack;
  } else if (error.cause !== undefined) {
    details.cause = String(error.cause);
  }

  return details;
}
