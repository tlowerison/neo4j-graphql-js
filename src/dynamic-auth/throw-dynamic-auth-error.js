import { ApolloError } from 'apollo-server-errors';

export const throwDynamicAuthError = errors => {
  throw new ApolloError(
    errors.map(({ error: code }) => camelCaseToErrorCodeCase(code)).join(';'),
    errors.map(({ name }) => name.split()).join(';')
  );
};

const camelCaseToErrorCodeCase = value =>
  value.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase();
