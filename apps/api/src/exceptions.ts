import { HttpException } from '@nestjs/common';
export class RateLimitException extends HttpException {constructor(message:string){super(message,429);}}
