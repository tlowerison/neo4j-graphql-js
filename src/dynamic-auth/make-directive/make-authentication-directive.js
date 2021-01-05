import { AuthorizationError } from '../errors';
import { DirectiveLocation, GraphQLList } from 'graphql';
import { createError } from 'apollo-errors';
import { defaultFieldResolver } from 'graphql';
import { intersection } from 'ramda';

export const AUTHENTICATION_NAME = 'authn';
export const AUTHENTICATION_DIRECTIVE = {
  customParams: [],
  instances: [],
  locations: [
    DirectiveLocation.FIELD_DEFINITION,
    DirectiveLocation.INTERFACE,
    DirectiveLocation.OBJECT,
    DirectiveLocation.UNION
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
        required: false,
        value: '[Role!]!'
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
        required: false,
        value: '[Scope!]!'
      },
      wrappers: [{ left: '[', right: ']' }]
    }
  ]
};

const visit = (resolve, allowedRoles, allowedScopes, shouldThrowErrorOnFail) =>
  function(root, params, context, info) {
    const userRoles = context.session?.me?.roles;
    const sessionScopes = context.session?.scopes;
    if (
      !(
        userRoles &&
        sessionScopes &&
        (allowedRoles.length === 0 ||
          intersection(allowedRoles, userRoles).length > 0) &&
        (allowedScopes.length === 0 ||
          intersection(allowedScopes, sessionScopes).length > 0)
      )
    ) {
      if (shouldThrowErrorOnFail) {
        throw new AuthorizationError();
      } else {
        return null;
      }
    }
    return resolve.call(this, root, params, context, info);
  };

export const makeAuthenticationDirective = (name, args) => ({
  visitFieldDefinition(field) {
    const { resolve } = field;
    if (resolve) {
      field.resolve = visit(
        resolve,
        args.roles || this.args.roles || [],
        args.scopes || this.args.scopes || [],
        true
      );
    }
  },
  visitInterface(interfaceType) {
    const { resolveInterface } = interfaceType;
    if (resolveInterface) {
      interfaceType.resolveInterface = visit(
        resolveInterface,
        args.roles || this.args.roles || [],
        args.scopes || this.args.scopes || [],
        false
      );
    }
  },
  visitObject(objectType) {
    const { resolveObject } = objectType;
    if (resolveObject) {
      objectType.resolveObject = visit(
        resolveObject,
        args.roles || this.args.roles || [],
        args.scopes || this.args.scopes || [],
        false
      );
    }
  },
  visitUnion(unionType) {
    const { resolveUnion } = unionType;
    if (resolveUnion) {
      unionType.resolveUnion = visit(
        resolveUnion,
        args.roles || this.args.roles || [],
        args.scopes || this.args.scopes || [],
        false
      );
    }
  }
});
