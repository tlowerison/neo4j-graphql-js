import { definition } from './definition';

const getParam = paramName =>
  definition.params.find(({ name }) => name === paramName);

export const getIsDefaultExpression = expression =>
  expression === getParam('expression')?.type.defaultValue;
