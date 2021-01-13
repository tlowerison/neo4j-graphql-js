import {
  DirectiveLocation,
  GraphQLEnumType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLString
} from 'graphql';
import { wrappers } from '../constants';

export const definition = {
  name: 'shield',
  customParams: [
    {
      name: 'this',
      wrappers: wrappers.string
    }
  ],
  instances: [],
  locations: [
    DirectiveLocation.FIELD_DEFINITION,
    DirectiveLocation.INTERFACE,
    DirectiveLocation.OBJECT
  ],
  params: [
    {
      name: 'expression',
      type: {
        defaultValue: 'TRUE',
        getType: () => new GraphQLNonNull(GraphQLString),
        getTypeDef: () => 'String!',
        getTypeName: () => 'String'
      },
      wrappers: wrappers.string
    },
    {
      name: 'error',
      type: {
        defaultValue: 'Unauthorized',
        getType: () => GraphQLString,
        getTypeDef: () => 'String',
        getTypeName: () => 'String'
      },
      wrappers: wrappers.string
    }
  ]
};
