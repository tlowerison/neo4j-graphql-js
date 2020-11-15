import { flatten, has, identity } from 'ramda';
import { getAdditionalLabels } from '../utils';
import { isListType } from 'graphql';

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
  return fieldAuthorizations.length > 0
    ? fieldAuthorizations
        .map(authorization => authorization(variableName))
        .filter(Boolean)
        .join(' AND ')
    : null;
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

const getRawAuthzPredicates = ({
  context: { authorizations },
  cypherParams,
  fieldName,
  innerSchemaType,
  resolveInfo,
  schemaType,
  typeNames: rawTypeNames,
  variableName
}) => {
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
  if (!typeNames.some(typeName => has(typeName, authorizations)))
    return { filter: null, shield: null };
  const authzFieldPredicate = getAuthzFieldPredicate({
    authorizations,
    fieldName,
    schemaType,
    typeNames,
    variableName
  });
  const authzNodePredicate = variableName
    ? getAuthzNodePredicate({ authorizations, typeNames, variableName })
    : null;
  const returnType = (resolveInfo.schema.getType(schemaType)?.getFields() ||
    {})[fieldName]?.type;
  if (returnType && isListType(returnType)) {
    return {
      authzFieldPredicate,
      filter: authzNodePredicate,
      shield: authzFieldPredicate
    };
  }
  const shield = [authzFieldPredicate, authzNodePredicate]
    .filter(Boolean)
    .join(' AND ');
  return {
    authzFieldPredicate,
    filter: null,
    shield: shield !== '' ? shield : null
  };
};

const replaceQuotes = value => value.replace(new RegExp('"', 'g'), '\\"');

export const getAuthzPredicates = config => {
  const { authzFieldPredicate, filter, shield } = getRawAuthzPredicates(config);
  return {
    filter,
    apocDoShield: authzFieldPredicate
      ? (value, argString) =>
          `CALL apoc.do.when(${authzFieldPredicate}, "${replaceQuotes(
            value
          )}", "RETURN NULL AS ${config.variableName}", ${toArgString(
            argString,
            false
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
            false
          )}) YIELD value RETURN value.${config.variableName} AS ${
            config.variableName
          }`
      : identity,
    shield: shield
      ? value => `CASE WHEN (${shield}) THEN ${value} ELSE NULL END`
      : identity
  };
};

export const toArgString = (argString, inProcedure = true) =>
  argString
    ? `{me:${inProcedure ? '$' : ''}me, ${argString.slice(
        1,
        argString.length - 1
      )}}`
    : `{me:${inProcedure ? '$' : ''}me}`;
