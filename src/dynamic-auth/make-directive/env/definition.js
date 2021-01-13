import { DirectiveLocation, GraphQLNonNull, GraphQLString } from 'graphql';
import { wrappers } from '../constants';

export const definition = {
  name: 'env',
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
