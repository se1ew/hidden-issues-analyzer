import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72,
    'Пароль должен содержать не больше 72 байт UTF-8'),
  name: z.string().trim().min(1).max(100).optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72,
    'Пароль должен содержать не больше 72 байт UTF-8'),
});
export type LoginInput = z.infer<typeof LoginSchema>;
