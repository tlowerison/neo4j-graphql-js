import { DirectiveLocation, GraphQLNonNull, GraphQLString } from 'graphql';
import { wrappers } from '../constants';

export const ENVIRONMENT_NAME = 'env';
export const ENVIRONMENT_DIRECTIVE = {
  customParams: [
    {
      name: 'this',
      wrappers: wrappers.string
    }
  ],
  instances: [],
  locations: [DirectiveLocation.FIELD_DEFINITION],
  params: [
    {
      name: 'provides',
      type: {
        defaultValue: '',
        getType: () => new GraphQLNonNull(GraphQLString),
        getTypeDef: () => 'String!',
        getTypeName: () => 'String!'
      },
      wrappers: wrappers.string
    }
  ]
};
