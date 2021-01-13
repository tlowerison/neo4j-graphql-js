import { definition } from './definition';
import { has } from 'ramda';
import { toAuthorization } from '../constants';

const getParam = paramName =>
  definition.params.find(({ name }) => name === paramName);

export const getIsDefaultExpression = expression =>
  expression === getParam('expression')?.type.defaultValue;

export const saveNodeAuthorization = ({
  authorizations,
  error,
  name,
  expression,
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
    shield: toAuthorization(expression, 'this')
  });
};
