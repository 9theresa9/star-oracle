import { z } from 'zod';
export const CreateReading = z.object({kind:z.enum(['tarot','iching']),question:z.string().trim().min(2).max(500),spread:z.enum(['single','three']).default('three'),allowReversed:z.boolean().default(true),requestId:z.string().uuid()}).strict();
export const JournalInput = z.object({note:z.string().max(600),mood:z.enum(['calm','hopeful','tired','restless','low']).nullable(),version:z.number().int().nonnegative()}).strict();
export const ShareInput = z.object({shared:z.boolean()}).strict();
export const AIInput = z.object({consent:z.literal(true)}).strict();
export const UserStatus = z.object({disabled:z.boolean()}).strict();
export const PageQuery = z.object({cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(50).default(20)}).strict();
