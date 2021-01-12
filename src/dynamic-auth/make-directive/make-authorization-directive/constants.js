import {
  DirectiveLocation,
  GraphQLEnumType,
  GraphQLList,
  GraphQLString
} from 'graphql';
import { wrappers } from '../constants';

export const AUTHORIZATION_NAME = 'authz';
export const AUTHORIZATION_DIRECTIVE = {
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
      name: 'roles',
      transform: value => value.split(',').map(role => role.trim()),
      type: {
        defaultValue: [],
        getType: (schema, typeName = 'Role') => {
          if (typeName === 'String') {
            return GraphQLString;
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
    },
    {
      name: 'scopes',
      transform: value => value.split(',').map(scope => scope.trim()),
      type: {
        defaultValue: [],
        getType: (schema, typeName = 'Scope') => {
          if (typeName === 'String') {
            return GraphQLString;
          }
          const ScopeType = schema.getType(typeName);
          if (!ScopeType || !(ScopeType instanceof GraphQLEnumType)) {
            return null;
          }
          return new GraphQLList(ScopeType);
        },
        getTypeDef: (typeName = 'Scope') => `[${typeName}!]`,
        getTypeName: options => options?.config?.auth?.scopeType
      },
      wrappers: wrappers.array
    },
    {
      name: 'shield',
      type: {
        defaultValue: 'TRUE',
        getType: () => GraphQLString,
        getTypeDef: () => 'String',
        getTypeName: () => 'String'
      },
      wrappers: wrappers.string
    },
    {
      name: 'filter',
      type: {
        defaultValue: 'items',
        getType: () => GraphQLString,
        getTypeDef: () => 'String',
        getTypeName: () => 'String'
      },
      wrappers: wrappers.string
    },
    {
      name: 'error',
      type: {
        defaultValue: 'Unknown error',
        getType: () => GraphQLString,
        getTypeDef: () => 'String',
        getTypeName: () => 'String'
      },
      wrappers: wrappers.string
    }
  ]
};
