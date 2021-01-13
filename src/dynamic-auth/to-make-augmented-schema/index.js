import { authorizations, environments } from '../build-context';
import { fromPairs, has, keys, mapObjIndexed, omit } from 'ramda';
import { makeDirective } from '../make-directive';
import { mungeTypeDefs } from './munge-type-defs';

export * from './constants';

export const toMakeAugmentedSchema = (
  makeBasicAugmentedSchema,
  neo4jgraphql
) => options => {
  if (!options?.config?.auth) {
    return makeBasicAugmentedSchema(options);
  }
  const { authDirectives, typeDefs } = mungeTypeDefs(options);
  const Query = { ...(options.resolvers?.Query || {}) };
  const Mutation = { ...(options.resolvers?.Mutation || {}) };
  const tempSchema = makeBasicAugmentedSchema({
    ...options,
    typeDefs,
    schemaDirectives: {
      ...mapObjIndexed(
        (authDirective, name) =>
          makeDirective(
            authDirective,
            name,
            { authorizations, environments },
            options.config
          ),
        authDirectives
      ),
      ...options.schemaDirectives
    }
  });
  const resolvers = {
    ...options.resolvers,
    Query: {
      ...(options.config?.query === false
        ? fromPairs(
            keys(tempSchema.getQueryType()?.getFields() || {})
              .filter(key => !has(key, Query))
              .map(key => [key, neo4jgraphql])
          )
        : options.resolvers?.Query),
      ...Query
    },
    Mutation: {
      ...(options.config?.mutation === false
        ? fromPairs(
            keys(tempSchema.getMutationType()?.getFields() || {})
              .filter(key => !has(key, Mutation))
              .map(key => [key, neo4jgraphql])
          )
        : options.resolvers?.Mutation),
      ...Mutation
    }
  };
  return makeBasicAugmentedSchema({
    ...options,
    resolvers,
    typeDefs,
    config: omit(['auth'], options.config || {}),
    schemaDirectives: {
      ...mapObjIndexed(
        (authDirective, name) =>
          makeDirective(authDirective, name, {}, options.config),
        authDirectives
      ),
      ...options.schemaDirectives
    }
  });
};
