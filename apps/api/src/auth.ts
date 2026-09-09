import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getPrisma } from './lib/prisma.js';

const registerSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8),
  name: z.string().trim().min(2).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1),
});

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return secret;
}

export function signAccessToken(userId: string) {
  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, getJwtSecret());

  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    throw new Error('Invalid token payload');
  }

  return payload.sub;
}

export async function registerUser(input: unknown) {
  const data = registerSchema.parse(input);
  const prisma = getPrisma();

  const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingUser) {
    throw new Error('EMAIL_ALREADY_IN_USE');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
  });

  return { user, token: signAccessToken(user.id) };
}

export async function loginUser(input: unknown) {
  const data = loginSchema.parse(input);
  const prisma = getPrisma();

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) {
    throw new Error('INVALID_CREDENTIALS');
  }

  const passwordMatches = await bcrypt.compare(data.password, user.passwordHash);
  if (!passwordMatches) {
    throw new Error('INVALID_CREDENTIALS');
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
    token: signAccessToken(user.id),
  };
}
