import { ApolloError } from 'apollo-server-errors';

export const throwDynamicAuthError = errors => {
  throw new ApolloError(
    errors
      .map(({ message }) =>
        typeof message === 'string' ? message : JSON.stringify(message)
      )
      .join(';'),
    errors.map(({ code }) => code).join(';')
  );
};
