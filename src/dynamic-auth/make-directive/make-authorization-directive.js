import { AuthorizationError } from '../authorization-error';
import {
  DirectiveLocation,
  GraphQLEnumType,
  GraphQLList,
  GraphQLString
} from 'graphql';
import { equals, has, intersection, values } from 'ramda';
import { print } from 'graphql';
import { typeIdentifiers } from '../../utils';

export const AUTHORIZATION_NAME = 'authz';
export const AUTHORIZATION_DIRECTIVE = {
  customParams: [
    {
      name: 'this',
      wrappers: [
        { left: '"', right: '"' },
        { left: '"""', right: '"""' }
      ]
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
      wrappers: [{ left: '[', right: ']' }]
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
      wrappers: [{ left: '[', right: ']' }]
    },
    // {
    //   name: 'filter',
    //   type: {
    //     defaultValue: 'items',
    //     getType: () => GraphQLString,
    //     getTypeDef: () => 'String',
    //     getTypeName: () => 'String',
    //   },
    // },
    {
      name: 'shield',
      type: {
        defaultValue: 'TRUE',
        getType: () => GraphQLString,
        getTypeDef: () => 'String',
        getTypeName: () => 'String'
      },
      wrappers: [
        { left: '"', right: '"' },
        { left: '"""', right: '"""' }
      ]
    }
  ]
};

export const makeAuthorizationDirective = (
  name,
  args,
  { authorizations = {} }
) => ({
  visitFieldDefinition(field, details) {
    const parentName = details.objectType.name;
    const { name: fieldName, resolve } = field;
    const { typeName } = typeIdentifiers(field.type);
    const filter = args.filter || this.args.filter;
    const shield = args.shield || this.args.shield;
    if (shield.trim().toUpperCase() !== 'TRUE') {
      if (!has(typeName, authorizations)) {
        authorizations[typeName] = {
          fields: {},
          node: []
        };
      }
      if (!has(fieldName, authorizations[typeName].fields)) {
        authorizations[typeName].fields[fieldName] = {};
      }
      if (!has(parentName, authorizations[typeName].fields[fieldName])) {
        authorizations[typeName].fields[fieldName][parentName] = [];
      }
      authorizations[typeName].fields[fieldName][parentName].push({
        // filter: toAuthorization(filter, 'items'),
        shield: toAuthorization(shield, 'this')
      });
    }
    const allowedRoles = args.roles || this.args.roles || [];
    const allowedScopes = args.scopes || this.args.scopes || [];
    if (allowedRoles.length > 0 || allowedScopes.length > 0) {
      field.resolve = visit(
        parentName,
        field.name,
        resolve,
        allowedRoles,
        allowedScopes,
        true
      );
    }
  },
  visitInterface(interfaceType) {
    const { name: typeName } = interfaceType;
    const shield = args.shield || this.args.shield;
    if (shield.trim().toUpperCase() !== 'TRUE') {
      saveNodeAuthorization({ authorizations, shield, typeName });
    }
    const allowedRoles = args.roles || this.args.roles || [];
    const allowedScopes = args.scopes || this.args.scopes || [];
    if (allowedRoles.length > 0 || allowedScopes.length > 0) {
      values(interfaceType.getFields()).forEach(
        field =>
          (field.resolve = visit(
            typeName,
            field.name,
            field.resolve,
            allowedRoles,
            allowedScopes
          ))
      );
    }
  },
  visitObject(objectType) {
    const { name: typeName } = objectType;
    const shield = args.shield || this.args.shield;
    if (shield.trim().toUpperCase() !== 'TRUE') {
      saveNodeAuthorization({ authorizations, shield, typeName });
    }
    const allowedRoles = args.roles || this.args.roles || [];
    const allowedScopes = args.scopes || this.args.scopes || [];
    if (allowedRoles.length > 0 || allowedScopes.length > 0) {
      values(objectType.getFields()).forEach(field => {
        field.resolve = visit(
          typeName,
          field.name,
          field.resolve,
          allowedRoles,
          allowedScopes
        );
      });
    }
  }
});

const toAuthorization = (statement, alias) => variableName =>
  `(${statement.replace(new RegExp(alias, 'g'), variableName)})`;

const saveNodeAuthorization = ({ authorizations, shield, typeName }) => {
  if (!has(typeName, authorizations)) {
    authorizations[typeName] = {
      fields: {},
      node: []
    };
  }
  authorizations[typeName].node.push(toAuthorization(shield, 'this'));
};

const roleSets = {};
const scopeSets = {};

const visit = (
  parentName,
  fieldName,
  resolve,
  allowedRoles,
  allowedScopes,
  isFieldLevel
) => {
  allowedRoles.sort();
  allowedScopes.sort();
  if (!roleSets[parentName]) {
    roleSets[parentName] = {};
  }
  if (!roleSets[parentName][fieldName]) {
    roleSets[parentName][fieldName] = [];
  }
  if (
    allowedRoles.length > 0 &&
    !roleSets[parentName][fieldName].find(roles => equals(roles, allowedRoles))
  ) {
    roleSets[parentName][fieldName].push(allowedRoles);
  }

  if (!scopeSets[parentName]) {
    scopeSets[parentName] = {};
  }
  if (!scopeSets[parentName][fieldName]) {
    scopeSets[parentName][fieldName] = [];
  }
  if (
    allowedScopes.length > 0 &&
    !scopeSets[parentName][fieldName].find(scopes =>
      equals(scopes, allowedScopes)
    )
  ) {
    scopeSets[parentName][fieldName].push(allowedScopes);
  }

  return function(root, params, context, info) {
    const userRoles =
      Array.isArray(context.cypherParams?._credentials?.roles) &&
      context.cypherParams._credentials.roles;
    const userScopes =
      Array.isArray(context.cypherParams?._credentials?.scopes) &&
      context.cypherParams._credentials.scopes;
    const allowedRoleSets = roleSets[parentName][fieldName];
    const allowedScopeSets = scopeSets[parentName][fieldName];
    if (
      !(
        userRoles &&
        userScopes &&
        allowedRoleSets.every(
          allowedRoles => intersection(allowedRoles, userRoles).length > 0
        ) &&
        allowedScopeSets.every(
          allowedScopes => intersection(allowedScopes, userScopes).length > 0
        )
      )
    ) {
      throw new AuthorizationError({
        message: `Unauthorized: Cannot access ${
          isFieldLevel ? `${parentName}.${fieldName}` : parentName
        }`
      });
    }
    return resolve.call(this, root, params, context, info);
  };
};
