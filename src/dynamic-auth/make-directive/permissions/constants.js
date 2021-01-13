import { AuthorizationError } from '../../authorization-error';
import { compose, equals, intersection, not } from 'ramda';
import { definition as rolesDefinition } from './roles';
import { definition as scopesDefinition } from './scopes';

const permissionSets = {};

const any = (required, values) => intersection(required, values).length > 0;
const all = (required, values) =>
  intersection(required, values).length === required.length;

const operations = {
  any,
  all,
  none: compose(not, any),
  notAll: compose(not, all)
};

export const getPermissionArgs = ({ all, any, none, notAll }) =>
  [
    { operation: 'all', values: all },
    { operation: 'any', values: any },
    { operation: 'none', values: none },
    { operation: 'notAll', values: notAll }
  ].filter(({ values }) => Boolean(values));

export const visitWithPermissions = (
  parentName,
  fieldName,
  resolve,
  permissions,
  isFieldLevel
) => {
  const { type, operation, values } = permissions;
  values.sort();
  if (!permissionSets[parentName]) {
    permissionSets[parentName] = {};
  }
  if (!permissionSets[parentName][fieldName]) {
    permissionSets[parentName][fieldName] = {
      [rolesDefinition.name]: [],
      [scopesDefinition.name]: []
    };
  }

  const permissionSet = { operation, values };
  if (
    values.length > 0 &&
    !permissionSets[parentName][fieldName][type].find(otherPermissionSet =>
      equals(otherPermissionSet, permissionSet)
    )
  ) {
    permissionSets[parentName][fieldName][type].push(permissionSet);
  }

  const message = `Unauthorized: Cannot access ${
    isFieldLevel ? `${parentName}.${fieldName}` : parentName
  }`;

  return function(root, params, context, info) {
    const roles =
      Array.isArray(context.cypherParams?._credentials?.roles) &&
      context.cypherParams._credentials.roles;
    const scopes =
      Array.isArray(context.cypherParams?._credentials?.scopes) &&
      context.cypherParams._credentials.scopes;

    if (!roles || !scopes) {
      throw new AuthorizationError({ message });
    }

    const {
      [rolesDefinition.name]: rolesPermissionSet,
      [scopesDefinition.name]: scopesPermissionSet
    } = permissionSets[parentName][fieldName];

    if (
      !rolesPermissionSet.every(({ operation, values: required }) =>
        operations[operation](required, roles)
      ) ||
      !scopesPermissionSet.every(({ operation, values: required }) =>
        operations[operation](required, scopes)
      )
    ) {
      throw new AuthorizationError({ message });
    }
    return resolve.call(this, root, params, context, info);
  };
};
