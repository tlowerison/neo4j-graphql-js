import {
  DirectiveLocation,
  GraphQLEnumType,
  GraphQLList,
  GraphQLString
} from 'graphql';
import { wrappers } from '../constants';

const baseParam = {
  transform: value => value.split(',').map(role => role.trim()),
  type: {
    defaultValue: null,
    getType: (schema, typeName = 'Role') => {
      if (typeName === 'String') {
        return new GraphQLList(GraphQLString);
      }
      const RoleType = schema.getType(typeName);
      if (!RoleType || !(RoleType instanceof GraphQLEnumType)) {
        return null;
      }
      return new GraphQLList(RoleType);
    },
    getTypeDef: (typeName = 'Role') => `[${typeName}!]`,
    getTypeName: options => options?.config?.auth?.roleType
  },
  wrappers: wrappers.array
};

export const baseDefinition = {
  customParams: [],
  instances: [],
  locations: [
    DirectiveLocation.FIELD_DEFINITION,
    DirectiveLocation.INTERFACE,
    DirectiveLocation.OBJECT
  ],
  params: [
    { name: 'any', ...baseParam },
    { name: 'all', ...baseParam },
    { name: 'none', ...baseParam },
    { name: 'notAll', ...baseParam }
  ]
};
