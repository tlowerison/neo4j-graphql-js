import { authorizations, environments } from '../build-context';
import { fromPairs, has, keys, mapObjIndexed } from 'ramda';
import { makeDirective } from '../make-directive';
import { mungeTypeDefs } from './munge-type-defs';

export * from './constants';

export const toMakeAugmentedSchema = (
  makeBasicAugmentedSchema,
  neo4jgraphql
) => config => {
  const { authDirectives, typeDefs } = mungeTypeDefs(config);
  const Query = { ...(config.resolvers?.Query || {}) };
  const Mutation = { ...(config.resolvers?.Mutation || {}) };
  const tempSchema = makeBasicAugmentedSchema({
    ...config,
    typeDefs,
    schemaDirectives: {
      ...mapObjIndexed(
        (authDirective, name) =>
          makeDirective(authDirective, name, { authorizations, environments }),
        authDirectives
      ),
      ...config.schemaDirectives
    }
  });
  const resolvers = {
    ...config.resolvers,
    Query: {
      ...(config?.config?.query === false
        ? fromPairs(
            keys(tempSchema.getQueryType()?.getFields() || {})
              .filter(key => !has(key, Query))
              .map(key => [key, neo4jgraphql])
          )
        : config.resolvers?.Query),
      ...Query
    },
    Mutation: {
      ...(config?.config?.mutation === false
        ? fromPairs(
            keys(tempSchema.getMutationType()?.getFields() || {})
              .filter(key => !has(key, Mutation))
              .map(key => [key, neo4jgraphql])
          )
        : config.resolvers?.Mutation),
      ...Mutation
    }
  };
  return makeBasicAugmentedSchema({
    ...config,
    resolvers,
    typeDefs,
    schemaDirectives: {
      ...mapObjIndexed(makeDirective, authDirectives),
      ...config.schemaDirectives
    }
  });
};
