import { RethrownExtendedErrorProps } from '../extended-error';
import { NonRetriableError } from '../non-retriable-error';

export class DiscordNonRetriableError extends NonRetriableError {
  public code: string;

  public requestId: string;

  public retryable: boolean;

  public retryDelay: number;

  public time: Date;

  constructor(message: string, props: RethrownExtendedErrorProps) {
    super(message, props);

    const error = props.error as any;
    this.code = error.code;
    this.requestId = error.requestId;
    this.retryable = error.retryable;
    this.retryDelay = error.retryDelay;
    this.time = error.time;

    // This is a limitation of typescript and jest
    // https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, DiscordNonRetriableError.prototype);
  }
}