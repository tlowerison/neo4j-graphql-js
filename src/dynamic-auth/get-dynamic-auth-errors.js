import { has } from 'ramda';

export const getDynamicAuthErrors = _errors => {
  if (_errors && Array.isArray(_errors)) {
    const nonNullErrors = _errors.filter(_error => _error?.error !== null);
    if (nonNullErrors.length > 0) {
      return nonNullErrors;
    }
  }
  return [];
};
