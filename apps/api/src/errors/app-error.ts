export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class BudgetExceededError extends AppError {
  constructor(
    channelId: string,
    public readonly todaySpend: number,
    public readonly budget: number,
  ) {
    super(`Budget exceeded for channel ${channelId}`, 429, 'BUDGET_EXCEEDED');
    this.name = 'BudgetExceededError';
  }
}

export class ProviderError extends AppError {
  constructor(message: string, statusCode = 502) {
    super(message, statusCode, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
  }
}
