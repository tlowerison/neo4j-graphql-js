import {
  getIsDefaultExpression,
  saveNodeAuthorization,
  visit
} from './constants';
import { has, values } from 'ramda';
import { toAuthorization } from '../constants';
import { typeIdentifiers } from '../../../utils';

export const makeDirective = (name, args, { authorizations = {} }) => ({
  visitFieldDefinition(field, details) {
    const parentName = details.objectType.name;
    const { name: fieldName } = field;
    const { typeName } = typeIdentifiers(field.type);
    const errorCode = (args.errorCode || this.args.errorCode).trim();
    const errorMessage = (args.errorMessage || this.args.errorMessage).trim();
    const expression = (args.expression || this.args.expression).trim();
    const isDefaultExpression = getIsDefaultExpression(expression);

    if (typeof expression === 'string' && !isDefaultExpression) {
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
        errorCode,
        errorMessage,
        name,
        shield: toAuthorization(expression, 'this')
      });
    }
  },
  visitInterface(interfaceType) {
    const { name: typeName } = interfaceType;
    const errorCode = (args.errorCode || this.args.errorCode).trim();
    const errorMessage = (args.errorMessage || this.args.errorMessage).trim();
    const expression = (args.expression || this.args.expression).trim();
    if (!getIsDefaultExpression(expression)) {
      saveNodeAuthorization({
        authorizations,
        errorCode,
        errorMessage,
        name,
        expression,
        typeName
      });
    }
  },
  visitObject(objectType) {
    const { name: typeName } = objectType;
    const errorCode = (args.errorCode || this.args.errorCode).trim();
    const errorMessage = (args.errorMessage || this.args.errorMessage).trim();
    const expression = (args.expression || this.args.expression).trim();
    if (!getIsDefaultExpression(expression)) {
      saveNodeAuthorization({
        authorizations,
        errorCode,
        errorMessage,
        name,
        expression,
        typeName
      });
    }
  }
});
