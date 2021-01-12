import { ApolloError } from 'apollo-server-errors';
import { has } from 'ramda';

export const handleErrors = _errors => {
  if (_errors && Array.isArray(_errors)) {
    const nonNullErrors = _errors.filter(_error => _error?.error !== null);
    if (nonNullErrors.length > 0) {
      return nonNullErrors;
    }
  }
  return [];
};

export const throwDynamicAuthError = errors => {
  throw new ApolloError(
    errors.map(({ error }) => error).join(';'),
    errors.map(({ name }) => name).join(';')
  );
};
