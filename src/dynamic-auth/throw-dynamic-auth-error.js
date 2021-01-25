import { ApolloError } from 'apollo-server-errors';

export const throwDynamicAuthError = errors => {
  throw new ApolloError(
    errors.map(({ error }) => error).join(';'),
    errors.map(({ name }) => name.split()).join(';')
  );
};
