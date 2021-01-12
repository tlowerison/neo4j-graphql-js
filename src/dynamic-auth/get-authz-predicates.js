import { flatten, has, identity } from 'ramda';
import { getAdditionalLabels } from '../utils';
import { getEnv } from './get-env';
import { isListType } from 'graphql';
import { toArgString } from './to-arg-string';

export const getAuthzPredicates = config => {
  const { filter, shield } = getRawAuthzPredicates(config);
  return {
    filter,
    customMutationShield: !shield
      ? identity
      : getCustomOperationShield(shield, config.variableName, true),
    customQueryShield: !shield
      ? identity
      : getCustomOperationShield(shield, config.variableName, false),
    shield: !shield
      ? identity
      : value => `CASE WHEN (${shield}) THEN ${value} ELSE NULL END`
  };
};

const getCustomOperationShield = (shield, variableName, isMutation) => (
  value,
  argString,
  varNames
) =>
  `\nWITH${
    varNames.length > 0 ? ` ${varNames.join(', ')},` : ''
  } [x IN ${shield} WHERE NOT x.shield | x { .name, .error }] AS _errors\nCALL apoc${
    isMutation ? '.do' : ''
  }.when(size(_errors) = 0, "${replaceQuotes(
    value
  )}", "RETURN _errors", ${toArgString(argString, {
    inProcedure: false,
    varNames: [...varNames, '_errors']
  })}) YIELD value RETURN value.${variableName} AS ${variableName}, value._errors AS _errors`;

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
    nodeVariableName,
    schemaType,
    typeNames,
    variableName
  });
  const authzNodePredicate = variableName
    ? getAuthzNodePredicate({
        authorizations,
        nodeVariableName,
        typeNames
      })
    : null;
  console.log({
    filter: [authzNodePredicate, authzFieldPredicate.filter]
      .filter(Boolean)
      .join(' AND '),
    shield: authzFieldPredicate.shield
  });
  return {
    filter: [authzNodePredicate, authzFieldPredicate.filter]
      .filter(Boolean)
      .join(' AND '),
    shield: authzFieldPredicate.shield
  };
};

const getAuthzFieldPredicate = ({
  authorizations,
  fieldName,
  nodeVariableName,
  schemaType,
  typeNames,
  variableName
}) => {
  console.log({
    fieldName,
    nodeVariableName,
    schemaType,
    typeNames,
    variableName
  });
  const fieldAuthorizations = flatten(
    typeNames.map(typeName => {
      const { fields } = authorizations[typeName];
      return has(fieldName, fields) && has(schemaType, fields[fieldName])
        ? fields[fieldName][schemaType] || []
        : [];
    })
  );
  console.log(fieldAuthorizations);
  if (fieldAuthorizations.length === 0) {
    return { filter: null, shield: null };
  }
  const filterFieldAuthorizations = fieldAuthorizations.filter(({ filter }) =>
    Boolean(filter)
  );
  const shieldFieldAuthorizations = fieldAuthorizations.filter(({ shield }) =>
    Boolean(shield)
  );
  return {
    filter:
      filterFieldAuthorizations.length > 0
        ? filterFieldAuthorizations
            .map(({ filter }) => filter(nodeVariableName))
            .join(' AND ')
        : null,
    shield:
      shieldFieldAuthorizations.length > 0
        ? `[${shieldFieldAuthorizations
            .map(
              ({ error, name, shield }) =>
                `{shield: ${shield(
                  variableName
                )}, name: '${name}', error: '${error}'}`
            )
            .join(', ')}]`
        : null
  };
};

const getAuthzNodePredicate = ({
  authorizations,
  nodeVariableName,
  typeNames
}) => {
  const nodeAuthorizations = flatten(
    typeNames.map(typeName => authorizations[typeName].node || [])
  );
  return nodeAuthorizations.length > 0
    ? nodeAuthorizations
        .map(({ shield }) => shield(nodeVariableName))
        .join(' AND ')
    : null;
};

const replaceQuotes = value => value.replace(new RegExp('"', 'g'), '\\"');
const withQuotes = value => `\`${value}\``;
const withoutQuotes = value => value.slice(1, value.length - 1);
