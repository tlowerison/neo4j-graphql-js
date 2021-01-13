import { getIsDefaultExpression } from './constants';
import { has, values } from 'ramda';
import { toAuthorization } from '../constants';
import { typeIdentifiers } from '../../../utils';

export const makeDirective = (name, args, { authorizations = {} }) => ({
  visitFieldDefinition(field, details) {
    const parentName = details.objectType.name;
    const { name: fieldName } = field;
    const { typeName } = typeIdentifiers(field.type);
    const expression = (args.expression || this.args.expression)?.trim();

    const isDefaultExpression = getIsDefaultExpression(expression);

    if (typeof expression === 'string' && !isDefaultExpression) {
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
      authorizations[typeName].fields[fieldName][parentName].push({
        filter: toAuthorization(expression, 'item')
      });
    }
  }
});
