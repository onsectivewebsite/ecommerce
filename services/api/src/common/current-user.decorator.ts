import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@onsective/shared-types';

export interface RequestUser {
  userId: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator<unknown, ExecutionContext, RequestUser>(
  (_data, ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as RequestUser;
  },
);
