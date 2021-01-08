import { flatten, has, identity } from 'ramda';
import { getAdditionalLabels } from '../utils';
import { getEnv } from './get-env';
import { isListType } from 'graphql';
import { toArgString } from './to-arg-string';

export const getAuthzPredicates = config => {
  const { authzFieldPredicate, filter, shield } = getRawAuthzPredicates(config);
  const { varNames } = getEnv(config);
  return {
    filter,
    apocDoShield: authzFieldPredicate
      ? (value, argString) =>
          `CALL apoc.do.when(${authzFieldPredicate}, "${replaceQuotes(
            value
          )}", "RETURN NULL AS ${config.variableName}", ${toArgString(
            argString,
            { inProcedure: false, varNames }
          )}) YIELD value RETURN value.${config.variableName} AS ${
            config.variableName
          }`
      : identity,
    apocShield: authzFieldPredicate
      ? (value, argString) =>
          `CALL apoc.when(${authzFieldPredicate}, "${replaceQuotes(
            value
          )}", "RETURN NULL AS ${config.variableName}", ${toArgString(
            argString,
            { inProcedure: false, varNames }
          )}) YIELD value RETURN value.${config.variableName} AS ${
            config.variableName
          }`
      : identity,
    shield: shield
      ? value => `CASE WHEN (${shield}) THEN ${value} ELSE NULL END`
      : identity
  };
};

const getRawAuthzPredicates = ({
  context: { authorizations },
  cypherParams,
  fieldName,
  filterVariableName,
  innerSchemaType,
  resolveInfo,
  schemaType,
  typeNames: rawTypeNames,
  variableName
}) => {
  const nodeVariableName = filterVariableName
    ? filterVariableName
    : variableName;
  const typeNames =
    !rawTypeNames && innerSchemaType
      ? [
          innerSchemaType.name,
          ...getAdditionalLabels(
            resolveInfo.schema.getType(innerSchemaType.name),
            cypherParams
          )
        ]
      : rawTypeNames || [];
  if (!typeNames.some(typeName => has(typeName, authorizations))) {
    return { filter: null, shield: null };
  }
  const authzFieldPredicate = getAuthzFieldPredicate({
    authorizations,
    fieldName,
    schemaType,
    typeNames,
    variableName
  });
  const authzNodePredicate = variableName
    ? getAuthzNodePredicate({
        authorizations,
        typeNames,
        variableName: nodeVariableName
      })
    : null;
  return {
    authzFieldPredicate: authzFieldPredicate?.shield || null,
    filter: authzNodePredicate,
    shield: authzFieldPredicate?.shield || null
  };
};

const getAuthzFieldPredicate = ({
  authorizations,
  fieldName,
  schemaType,
  typeNames,
  variableName
}) => {
  const fieldAuthorizations = flatten(
    typeNames.map(typeName => {
      const { fields } = authorizations[typeName];
      return has(fieldName, fields) && has(schemaType, fields[fieldName])
        ? fields[fieldName][schemaType] || []
        : [];
    })
  );
  if (fieldAuthorizations.length === 0) {
    return null;
  }
  return {
    shield: fieldAuthorizations
      .map(({ shield }) => shield(variableName))
      .join(' AND ')
  };
};

const getAuthzNodePredicate = ({ authorizations, typeNames, variableName }) => {
  const nodeAuthorizations = flatten(
    typeNames.map(typeName => authorizations[typeName].node || [])
  );
  return nodeAuthorizations.length > 0
    ? nodeAuthorizations
        .map(authorization => authorization(variableName))
        .join(' AND ')
    : null;
};

const replaceQuotes = value => value.replace(new RegExp('"', 'g'), '\\"');
