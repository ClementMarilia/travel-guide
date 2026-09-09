import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../auth.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  const authorization = request.header('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    response.status(401).json({ message: 'Authentication required' });
    return;
  }

  try {
    request.userId = verifyAccessToken(authorization.slice(7));
    next();
  } catch {
    response.status(401).json({ message: 'Invalid or expired token' });
  }
}
