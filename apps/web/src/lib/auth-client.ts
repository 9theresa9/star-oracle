import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
import { apiOrigin } from './api';
export const authClient=createAuthClient({baseURL:apiOrigin,plugins:[twoFactorClient()]});
