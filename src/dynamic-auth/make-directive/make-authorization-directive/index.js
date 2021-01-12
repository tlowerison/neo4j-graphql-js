import { has, values } from 'ramda';
import { typeIdentifiers } from '../../../utils';
import {
  getIsDefaultFilter,
  getIsDefaultShield,
  saveNodeAuthorization,
  toAuthorization,
  visit
} from './utils';

export * from './constants';

export const makeAuthorizationDirective = (
  name,
  args,
  { authorizations = {} }
) => ({
  visitFieldDefinition(field, details) {
    const parentName = details.objectType.name;
    const { name: fieldName, resolve } = field;
    const { typeName } = typeIdentifiers(field.type);
    const error = (args.error || this.args.error).trim();
    const filter = (args.filter || this.args.filter)?.trim();
    const shield = (args.shield || this.args.shield).trim();

    const isDefaultFilter = getIsDefaultFilter(filter);
    const isDefaultShield = getIsDefaultShield(shield);

    if (!isDefaultFilter || !isDefaultShield) {
      const authorization = { name };
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
      if (!isDefaultFilter) {
        authorization.filter = toAuthorization(filter, 'item');
      }
      if (!isDefaultShield) {
        authorization.error = error;
        authorization.shield = toAuthorization(shield, 'this');
      }
      authorizations[typeName].fields[fieldName][parentName].push(
        authorization
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
    const error = (args.error || this.args.error).trim();
    const shield = (args.shield || this.args.shield).trim();
    if (getIsDefaultShield(shield)) {
      saveNodeAuthorization({ authorizations, error, name, shield, typeName });
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
    const error = (args.error || this.args.error).trim();
    const shield = (args.shield || this.args.shield).trim();
    if (getIsDefaultShield(shield)) {
      saveNodeAuthorization({ authorizations, error, name, shield, typeName });
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
