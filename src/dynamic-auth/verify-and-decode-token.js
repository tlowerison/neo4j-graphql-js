import { AuthorizationError } from './authorization-error';
import { createError } from 'apollo-errors';
import { decode, verify } from 'jsonwebtoken';

export const verifyAndDecodeToken = req => {
  if (
    !req ||
    !req.headers ||
    (!req.headers.authorization && !req.headers.Authorization) ||
    (!req && !req.cookies && !req.cookies.token)
  ) {
    throw new AuthorizationError({ message: 'No authorization token.' });
  }

  const token =
    req.headers.authorization || req.headers.Authorization || req.cookies.token;
  try {
    const id_token = token.replace('Bearer ', '');
    const { JWT_SECRET, JWT_NO_VERIFY } = process.env;

    if (!JWT_SECRET && JWT_NO_VERIFY) {
      return decode(id_token);
    } else {
      return verify(id_token, JWT_SECRET, {
        algorithms: ['HS256', 'RS256']
      });
    }
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AuthorizationError({
        message: 'Your token is expired'
      });
    } else {
      throw new AuthorizationError({
        message: 'You are not authorized for this resource'
      });
    }
  }
};
