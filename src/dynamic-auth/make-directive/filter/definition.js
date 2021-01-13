import {
  DirectiveLocation,
  GraphQLEnumType,
  GraphQLList,
  GraphQLString
} from 'graphql';
import { wrappers } from '../constants';

export const definition = {
  name: 'filter',
  customParams: [],
  instances: [],
  locations: [DirectiveLocation.FIELD_DEFINITION],
  params: [
    {
      name: 'expression',
      type: {
        defaultValue: null,
        getType: () => GraphQLString,
        getTypeDef: () => 'String',
        getTypeName: () => 'String'
      },
      wrappers: wrappers.string
    }
  ]
};
