import { DirectiveLocation, GraphQLList, GraphQLString } from 'graphql';
import { createError } from 'apollo-errors';
import { has, intersection, values } from 'ramda';
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
        getType: schema => {
          const RoleType = schema.getType('Role');
          if (!RoleType) {
            throw new Error('Role enum is required');
          }
          return new GraphQLList(RoleType);
        },
        value: '[Role!]'
      },
      wrappers: [{ left: '[', right: ']' }]
    },
    {
      name: 'scopes',
      transform: value => value.split(',').map(scope => scope.trim()),
      type: {
        defaultValue: [],
        getType: schema => {
          const ScopeType = schema.getType('Scope');
          if (!ScopeType) {
            throw new Error('Scope enum is required');
          }
          return new GraphQLList(ScopeType);
        },
        value: '[Scope!]'
      },
      wrappers: [{ left: '[', right: ']' }]
    },
    {
      name: 'statement',
      type: {
        defaultValue: 'TRUE',
        getType: () => GraphQLString,
        value: 'String'
      },
      wrappers: [
        { left: '"', right: '"' },
        { left: '"""', right: '"""' }
      ]
    }
  ]
};

const AuthorizationError = createError('AuthorizationError', {
  message: 'You are not authorized.'
});

const toAuthorization = statement => variableName =>
  `(${statement.replace(new RegExp('this', 'g'), variableName)})`;

const saveNodeAuthorization = ({ authorizations, statement, typeName }) => {
  if (!has(typeName, authorizations)) {
    authorizations[typeName] = {
      fields: {},
      node: []
    };
  }
  authorizations[typeName].node.push(toAuthorization(statement));
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
  if (!roleSets[parentName]) {
    roleSets[parentName] = {};
  }
  if (!roleSets[parentName][fieldName]) {
    roleSets[parentName][fieldName] = [];
  }
  roleSets[parentName][fieldName].push(allowedRoles);

  if (!scopeSets[parentName]) {
    scopeSets[parentName] = {};
  }
  if (!scopeSets[parentName][fieldName]) {
    scopeSets[parentName][fieldName] = [];
  }
  scopeSets[parentName][fieldName].push(allowedScopes);

  return function(root, params, context, info) {
    const userRoles = context.cypherParams?.me?.roles;
    const userScopes = context.cypherParams?.me?.scopes;
    const allowedRoleSets = roleSets[parentName][fieldName];
    const allowedScopeSets = scopeSets[parentName][fieldName];
    if (
      !(
        userRoles &&
        userScopes &&
        allowedRoleSets.every(
          allowedRoles =>
            allowedRoles.length === 0 ||
            intersection(allowedRoles, userRoles).length > 0
        ) &&
        allowedScopeSets.every(
          allowedScopes =>
            allowedScopes.length === 0 ||
            intersection(allowedScopes, userScopes).length > 0
        )
      )
    ) {
      const operationName = info.operation.name?.value;
      throw new AuthorizationError({
        message: `Unauthorized: Cannot access ${
          isFieldLevel ? `${parentName}.${fieldName}` : parentName
        }`
      });
    }
    return resolve.call(this, root, params, context, info);
  };
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
    const statement = args.statement || this.args.statement;
    if (statement.trim().toUpperCase() !== 'TRUE') {
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
      authorizations[typeName].fields[fieldName][parentName].push(
        toAuthorization(statement)
      );
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
    const statement = args.statement || this.args.statement;
    if (statement.trim().toUpperCase() !== 'TRUE') {
      saveNodeAuthorization({ authorizations, statement, typeName });
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
    const statement = args.statement || this.args.statement;
    if (statement.trim().toUpperCase() !== 'TRUE') {
      saveNodeAuthorization({ authorizations, statement, typeName });
    }
    const allowedRoles = args.roles || this.args.roles || [];
    const allowedScopes = args.scopes || this.args.scopes || [];
    if (allowedRoles.length > 0 || allowedScopes.length > 0) {
      values(objectType.getFields()).forEach(
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
  }
});
