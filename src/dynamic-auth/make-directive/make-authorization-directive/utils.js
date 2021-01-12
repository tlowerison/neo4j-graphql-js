import { AUTHORIZATION_DIRECTIVE } from './constants';
import { AuthorizationError } from '../../authorization-error';
import { equals, has, intersection } from 'ramda';

const getParam = paramName =>
  AUTHORIZATION_DIRECTIVE.params.find(({ name }) => name === paramName);
export const getIsDefaultFallback = error =>
  error === getParam('error')?.type.defaultValue;
export const getIsDefaultFilter = filter =>
  filter === getParam('filter')?.type.defaultValue;
export const getIsDefaultShield = shield =>
  shield === getParam('shield')?.type.defaultValue;

export const toAuthorization = (statement, alias) => variableName =>
  `${statement.replace(new RegExp(alias, 'g'), variableName)}`;

export const saveNodeAuthorization = ({
  authorizations,
  error,
  name,
  shield,
  typeName
}) => {
  if (!has(typeName, authorizations)) {
    authorizations[typeName] = {
      fields: {},
      node: []
    };
  }
  authorizations[typeName].node.push({
    error,
    name,
    shield: toAuthorization(shield, 'this')
  });
};

const roleSets = {};
const scopeSets = {};

export const visit = (
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
